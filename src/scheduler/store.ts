import crypto from 'node:crypto'
import { promises as fs } from 'node:fs'
import { existsSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import type { ScheduledExecution, ScheduledJob } from './types.js'

export function createSchedulerStore(rootDir: string) {
  const jobsDir = path.join(rootDir, 'jobs')
  const executionsDir = path.join(rootDir, 'executions')
  mkdirSync(jobsDir, { recursive: true })
  mkdirSync(executionsDir, { recursive: true })

  async function listJobs(): Promise<ScheduledJob[]> {
    const entries = await fs.readdir(jobsDir, { withFileTypes: true })
    const jobs: ScheduledJob[] = []
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.json')) continue
      try {
        const raw = await fs.readFile(path.join(jobsDir, entry.name), 'utf8')
        jobs.push(JSON.parse(raw) as ScheduledJob)
      } catch {
        continue
      }
    }
    return jobs.sort((left, right) => left.createdAt.localeCompare(right.createdAt))
  }

  async function getJob(jobId: string): Promise<ScheduledJob | null> {
    const filePath = path.join(jobsDir, `${jobId}.json`)
    if (!existsSync(filePath)) return null
    const raw = await fs.readFile(filePath, 'utf8')
    return JSON.parse(raw) as ScheduledJob
  }

  async function saveJob(job: ScheduledJob): Promise<void> {
    await writeJsonAtomic(path.join(jobsDir, `${job.id}.json`), job)
  }

  async function createJob(input: Omit<ScheduledJob, 'id' | 'createdAt' | 'updatedAt'>): Promise<ScheduledJob> {
    const timestamp = new Date().toISOString()
    const job: ScheduledJob = {
      ...input,
      id: crypto.randomUUID(),
      createdAt: timestamp,
      updatedAt: timestamp,
    }
    await saveJob(job)
    return job
  }

  async function updateJob(jobId: string, patch: Partial<Omit<ScheduledJob, 'id' | 'createdAt'>>): Promise<ScheduledJob> {
    const current = await getJob(jobId)
    if (!current) {
      throw new Error(`Scheduled job not found: ${jobId}`)
    }
    const next: ScheduledJob = {
      ...current,
      ...patch,
      id: current.id,
      createdAt: current.createdAt,
      updatedAt: new Date().toISOString(),
    }
    await saveJob(next)
    return next
  }

  async function deleteJob(jobId: string): Promise<void> {
    const filePath = path.join(jobsDir, `${jobId}.json`)
    if (existsSync(filePath)) {
      await fs.unlink(filePath)
    }
  }

  async function listExecutions(jobId?: string): Promise<ScheduledExecution[]> {
    const entries = await fs.readdir(executionsDir, { withFileTypes: true })
    const executions: ScheduledExecution[] = []
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.json')) continue
      try {
        const raw = await fs.readFile(path.join(executionsDir, entry.name), 'utf8')
        const execution = JSON.parse(raw) as ScheduledExecution
        if (!jobId || execution.jobId === jobId) {
          executions.push(execution)
        }
      } catch {
        continue
      }
    }
    return executions.sort((left, right) => right.createdAt.localeCompare(left.createdAt))
  }

  async function getExecution(executionId: string): Promise<ScheduledExecution | null> {
    const filePath = path.join(executionsDir, `${executionId}.json`)
    if (!existsSync(filePath)) return null
    const raw = await fs.readFile(filePath, 'utf8')
    return JSON.parse(raw) as ScheduledExecution
  }

  async function saveExecution(execution: ScheduledExecution): Promise<void> {
    await writeJsonAtomic(path.join(executionsDir, `${execution.id}.json`), execution)
  }

  async function createExecution(input: Omit<ScheduledExecution, 'id' | 'createdAt' | 'updatedAt'>): Promise<ScheduledExecution> {
    const timestamp = new Date().toISOString()
    const execution: ScheduledExecution = {
      ...input,
      id: crypto.randomUUID(),
      createdAt: timestamp,
      updatedAt: timestamp,
    }
    await saveExecution(execution)
    return execution
  }

  async function updateExecution(
    executionId: string,
    patch: Partial<Omit<ScheduledExecution, 'id' | 'createdAt'>>
  ): Promise<ScheduledExecution> {
    const current = await getExecution(executionId)
    if (!current) {
      throw new Error(`Scheduled execution not found: ${executionId}`)
    }
    const next: ScheduledExecution = {
      ...current,
      ...patch,
      id: current.id,
      createdAt: current.createdAt,
      updatedAt: new Date().toISOString(),
    }
    await saveExecution(next)
    return next
  }

  return {
    jobsDir,
    executionsDir,
    listJobs,
    getJob,
    saveJob,
    createJob,
    updateJob,
    deleteJob,
    listExecutions,
    getExecution,
    saveExecution,
    createExecution,
    updateExecution,
  }
}

async function writeJsonAtomic(filePath: string, data: unknown): Promise<void> {
  const tmpPath = `${filePath}.${process.pid}.tmp`
  await fs.writeFile(tmpPath, JSON.stringify(data, null, 2), 'utf8')
  await fs.rename(tmpPath, filePath)
}
