/** 공유 상수 — spawner, jobs 등에서 공통 사용 */

/** NaN-safe parseInt: 파싱 실패 시 기본값 반환 */
function safeInt(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = parseInt(value, 10);
  return Number.isNaN(parsed) ? fallback : parsed;
}

export const MAX_STDOUT = safeInt(process.env.TED_CREW_MAX_STDOUT, 10485760); // 10MB
export const MAX_STDERR = 1 * 1024 * 1024; // 1MB
export const DEFAULT_TIMEOUT = safeInt(process.env.TED_CREW_TIMEOUT, 300000); // 5분

export const JOB_TTL_MS = 60 * 60 * 1000; // 완료된 Job 유지 시간 (1시간)
export const JOB_GC_INTERVAL_MS = 10 * 60 * 1000; // GC 주기 (10분)
