import type { Config } from './config.js'
import type { AdmissionPreview } from './scheduler.js'

export type AdmissionPolicyEvaluation = {
  enforcement_mode: NonNullable<Config['admission_control']>['enforcement_mode'] | 'observe-only'
  should_reject: boolean
  status_code: number
  headers: Record<string, string>
  body: {
    error: string
    admission_advice: AdmissionPreview['advice']
    reason_codes: AdmissionPreview['reason_codes']
    projected_active_sessions: number
    quota_state: AdmissionPreview['quota_state']
    drain_state: AdmissionPreview['drain_state']
    usage_pressure_state?: AdmissionPreview['usage_pressure_state']
  }
}

export function evaluateAdmissionPolicy(
  config: Config,
  preview: AdmissionPreview,
): AdmissionPolicyEvaluation {
  const enforcementMode = config.admission_control?.enforcement_mode || 'observe-only'
  const statusCode = config.admission_control?.reject_status_code || 429
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }

  if (preview.retry_after_seconds != null) {
    headers['Retry-After'] = String(preview.retry_after_seconds)
  }

  return {
    enforcement_mode: enforcementMode,
    should_reject: shouldReject(enforcementMode, preview),
    status_code: statusCode,
    headers,
    body: {
      error: 'Admission rejected by scheduler policy',
      admission_advice: preview.advice,
      reason_codes: preview.reason_codes,
      projected_active_sessions: preview.projected_active_sessions,
      quota_state: preview.quota_state,
      drain_state: preview.drain_state,
      usage_pressure_state: preview.usage_pressure_state,
    },
  }
}

function shouldReject(
  mode: NonNullable<Config['admission_control']>['enforcement_mode'] | 'observe-only',
  preview: AdmissionPreview,
): boolean {
  if (mode === 'observe-only') {
    return false
  }
  if (mode === 'reject-block-new') {
    return preview.advice === 'BLOCK_NEW'
  }
  if (mode === 'reject-queue-preferred') {
    return preview.advice !== 'OPEN'
  }
  return false
}
