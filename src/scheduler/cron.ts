const CRON_FIELD_RANGES = [
  { name: 'minute', min: 0, max: 59 },
  { name: 'hour', min: 0, max: 23 },
  { name: 'dayOfMonth', min: 1, max: 31 },
  { name: 'month', min: 1, max: 12 },
  { name: 'dayOfWeek', min: 0, max: 6 },
] as const

type CronFieldName = typeof CRON_FIELD_RANGES[number]['name']

interface CronFields {
  minute: Set<number>
  hour: Set<number>
  dayOfMonth: Set<number>
  month: Set<number>
  dayOfWeek: Set<number>
}

interface ZonedDateParts {
  year: number
  month: number
  day: number
  hour: number
  minute: number
  second: number
  weekday: number
}

export function computeNextCronRunAt(
  expression: string,
  timezone: string | undefined,
  afterDate = new Date()
): string {
  const fields = parseCronExpression(expression)
  const tz = normalizeTimezone(timezone)

  let candidate = new Date(afterDate.getTime())
  candidate.setSeconds(0, 0)
  candidate = new Date(candidate.getTime() + 60_000)

  const maxIterations = 366 * 24 * 60 * 5
  for (let index = 0; index < maxIterations; index += 1) {
    const parts = getZonedDateParts(candidate, tz)
    if (matchesCron(fields, parts)) {
      return candidate.toISOString()
    }
    candidate = new Date(candidate.getTime() + 60_000)
  }

  throw new Error(`Unable to compute next cron run for expression: ${expression}`)
}

export function validateTimezone(timezone: string | undefined): string | undefined {
  if (!timezone) {
    return undefined
  }
  return normalizeTimezone(timezone)
}

function parseCronExpression(expression: string): CronFields {
  const normalized = String(expression || '').trim()
  const parts = normalized.split(/\s+/).filter(Boolean)
  if (parts.length !== 5) {
    throw new Error('Cron expression must contain exactly 5 fields')
  }

  return {
    minute: parseCronField(parts[0]!, CRON_FIELD_RANGES[0].min, CRON_FIELD_RANGES[0].max, 'minute'),
    hour: parseCronField(parts[1]!, CRON_FIELD_RANGES[1].min, CRON_FIELD_RANGES[1].max, 'hour'),
    dayOfMonth: parseCronField(parts[2]!, CRON_FIELD_RANGES[2].min, CRON_FIELD_RANGES[2].max, 'dayOfMonth'),
    month: parseCronField(parts[3]!, CRON_FIELD_RANGES[3].min, CRON_FIELD_RANGES[3].max, 'month'),
    dayOfWeek: parseCronField(parts[4]!, CRON_FIELD_RANGES[4].min, CRON_FIELD_RANGES[4].max, 'dayOfWeek', true),
  }
}

function parseCronField(
  token: string,
  min: number,
  max: number,
  fieldName: CronFieldName,
  normalizeDayOfWeek = false
): Set<number> {
  const values = new Set<number>()
  const segments = token.split(',')
  for (const segment of segments) {
    const normalized = segment.trim()
    if (!normalized) {
      throw new Error(`Invalid cron ${fieldName} field`)
    }

    const [base, stepPart] = normalized.split('/')
    const step = stepPart ? parsePositiveInteger(stepPart, `${fieldName} step`) : 1
    if (step <= 0) {
      throw new Error(`Cron ${fieldName} step must be positive`)
    }

    if (!base) {
      throw new Error(`Invalid cron ${fieldName} field`)
    }

    if (base === '*') {
      addRange(values, min, max, step, normalizeDayOfWeek)
      continue
    }

    if (base.includes('-')) {
      const [startPart, endPart] = base.split('-')
      const start = normalizeCronValue(parseCronValue(startPart, min, max, fieldName), normalizeDayOfWeek)
      const end = normalizeCronValue(parseCronValue(endPart, min, max, fieldName), normalizeDayOfWeek)
      if (start > end) {
        throw new Error(`Cron ${fieldName} range start must be <= end`)
      }
      addRange(values, start, end, step, normalizeDayOfWeek)
      continue
    }

    const value = normalizeCronValue(parseCronValue(base, min, max, fieldName), normalizeDayOfWeek)
    values.add(value)
  }

  if (values.size === 0) {
    throw new Error(`Cron ${fieldName} field is empty`)
  }
  return values
}

function parseCronValue(token: string | undefined, min: number, max: number, fieldName: CronFieldName): number {
  const value = parsePositiveInteger(token, fieldName)
  if (value < min || value > max) {
    throw new Error(`Cron ${fieldName} must be between ${min} and ${max}`)
  }
  return value
}

function normalizeCronValue(value: number, normalizeDayOfWeek: boolean): number {
  if (normalizeDayOfWeek && value === 7) {
    return 0
  }
  return value
}

function addRange(
  target: Set<number>,
  start: number,
  end: number,
  step: number,
  normalizeDayOfWeek: boolean
): void {
  for (let value = start; value <= end; value += step) {
    target.add(normalizeCronValue(value, normalizeDayOfWeek))
  }
}

function parsePositiveInteger(token: string | undefined, fieldName: string): number {
  const normalized = String(token || '').trim()
  if (!/^\d+$/.test(normalized)) {
    throw new Error(`Cron ${fieldName} must be an integer`)
  }
  return Number.parseInt(normalized, 10)
}

function matchesCron(fields: CronFields, parts: ZonedDateParts): boolean {
  return fields.minute.has(parts.minute) &&
    fields.hour.has(parts.hour) &&
    fields.dayOfMonth.has(parts.day) &&
    fields.month.has(parts.month) &&
    fields.dayOfWeek.has(parts.weekday)
}

function normalizeTimezone(timezone: string | undefined): string {
  const normalized = String(timezone || '').trim() || 'UTC'
  try {
    new Intl.DateTimeFormat('en-US', {
      timeZone: normalized,
      year: 'numeric',
    }).format(new Date())
    return normalized
  } catch {
    throw new Error(`Invalid timezone: ${normalized}`)
  }
}

function getZonedDateParts(date: Date, timezone: string): ZonedDateParts {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
    weekday: 'short',
  })

  const rawParts = formatter.formatToParts(date)
  const values = new Map<string, string>()
  for (const part of rawParts) {
    if (part.type !== 'literal') {
      values.set(part.type, part.value)
    }
  }

  return {
    year: Number.parseInt(values.get('year') || '0', 10),
    month: Number.parseInt(values.get('month') || '0', 10),
    day: Number.parseInt(values.get('day') || '0', 10),
    hour: Number.parseInt(values.get('hour') || '0', 10),
    minute: Number.parseInt(values.get('minute') || '0', 10),
    second: Number.parseInt(values.get('second') || '0', 10),
    weekday: mapWeekday(values.get('weekday')),
  }
}

function mapWeekday(value: string | undefined): number {
  switch (value) {
    case 'Sun':
      return 0
    case 'Mon':
      return 1
    case 'Tue':
      return 2
    case 'Wed':
      return 3
    case 'Thu':
      return 4
    case 'Fri':
      return 5
    case 'Sat':
      return 6
    default:
      throw new Error(`Unsupported weekday value: ${String(value || '')}`)
  }
}
