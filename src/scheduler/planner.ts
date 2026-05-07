import type { ScheduledJob, ScheduledJobSchedule } from './types.js'
import { computeNextCronRunAt } from './cron.js'

export function computeNextRunAt(schedule: ScheduledJobSchedule, now = new Date()): string | null {
  if (schedule.type === 'once') {
    const runAt = new Date(schedule.runAt)
    if (Number.isNaN(runAt.getTime())) {
      throw new Error('Invalid once schedule runAt')
    }
    return runAt.toISOString()
  }

  if (schedule.type === 'interval') {
    if (!Number.isFinite(schedule.everyMs) || schedule.everyMs <= 0) {
      throw new Error('Interval schedule everyMs must be a positive number')
    }
    return new Date(now.getTime() + schedule.everyMs).toISOString()
  }

  if (schedule.type === 'cron') {
    return computeNextCronRunAt(schedule.expression, schedule.timezone, now)
  }

  throw new Error('Unsupported schedule type')
}

export function computeSubsequentRunAt(job: ScheduledJob, fromDate = new Date()): string | null {
  if (job.schedule.type === 'once') {
    return null
  }

  if (job.schedule.type === 'interval') {
    return new Date(fromDate.getTime() + job.schedule.everyMs).toISOString()
  }

  if (job.schedule.type === 'cron') {
    return computeNextCronRunAt(job.schedule.expression, job.schedule.timezone, fromDate)
  }

  throw new Error('Unsupported schedule type')
}

export function isJobDue(job: ScheduledJob, now = new Date()): boolean {
  if (!job.enabled || !job.nextRunAt) {
    return false
  }
  const nextRun = new Date(job.nextRunAt)
  if (Number.isNaN(nextRun.getTime())) {
    return false
  }
  return nextRun.getTime() <= now.getTime()
}
