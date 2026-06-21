/**
 * 前端类型定义
 */

export interface Config {
  appTitle: string
  configured: boolean
  model: string
  defaultSystemPrompt: string
  maxAgentSteps: number
  maxContextTokens: number
  defaultWorkspaceRoot: string
  sandboxEnabled: boolean
  seatbeltEnabled: boolean
  schedulerEnabled: boolean
  schedulerMaxConcurrency: number
  schedulerPollIntervalMs: number
  memoryEnabled: boolean
  marketEnabled: boolean
  skills: SkillInfo[]
  tools: ToolInfo[]
}

export interface SkillInfo {
  name: string
  description: string
}

export interface ToolInfo {
  name: string
  description: string
  input_schema: Record<string, unknown>
}

export interface WorkspaceEntry {
  name: string
  path: string
  kind: 'file' | 'directory'
  extension?: string
}

export interface WorkspaceListing {
  workspaceRoot: string
  path: string
  exists: boolean
  entries: WorkspaceEntry[]
}

export interface WorkspaceFile {
  workspaceRoot: string
  path: string
  contentType: 'markdown' | 'text' | 'image' | 'binary'
  content?: string
  size: number
  extension?: string
  mediaType?: string
}

export interface ModelUsageCounters {
  requestCount: number
  responseCount: number
  errorCount: number
  inputTokens: number
  outputTokens: number
  totalTokens: number
  cachedTokens: number
  cacheWriteTokens: number
  reasoningTokens: number
  cost: number
  durationMs: number
  toolUseCount: number
}

export interface ModelUsageModelStats extends ModelUsageCounters {
  model: string
  providerModels: string[]
  usageFields: Record<string, number>
  averageDurationMs: number | null
  firstSeenAt: string | null
  lastSeenAt: string | null
  lastRequestAt: string | null
  lastResponseAt: string | null
  lastErrorAt: string | null
}

export interface ModelUsageSummary {
  generatedAt: string
  logPath: string
  logBytes: number
  parsedLineCount: number
  skippedLineCount: number
  modelCount: number
  usageFieldKeys: string[]
  totals: ModelUsageCounters
  models: ModelUsageModelStats[]
}

export type EvolutionProposalType =
  | 'memory_write'
  | 'memory_merge'
  | 'agents_patch'
  | 'skill_create'
  | 'skill_patch'

export type EvolutionProposalStatus = 'pending' | 'accepted' | 'rejected' | 'applied'

export interface EvolutionProposal {
  id: string
  type: EvolutionProposalType
  title: string
  rationale: string
  sourceRunIds: string[]
  sourceSessionIds: string[]
  suggestedChange: string
  patch?: string
  payload?: Record<string, unknown>
  risk: 'low' | 'medium' | 'high'
  status: EvolutionProposalStatus
  reviewNote?: string
  reviewedAt?: string
  appliedAt?: string
  applyResult?: ProposalApplyResult
  createdAt: string
  updatedAt: string
}

export interface ProposalApplyValidation {
  name: string
  ok: boolean
  output: string
}

export interface ProposalApplyResult {
  ok: boolean
  adapter: 'workspace_memory' | 'workspace_agents' | 'workspace_skill'
  changedFiles: string[]
  validation: ProposalApplyValidation[]
  preview: string
  auditPath?: string
  error?: string
  appliedBy?: string
  appliedAt: string
}

export interface ProposalApplyResponse {
  proposal: EvolutionProposal
  dryRun: boolean
  changedFiles: string[]
  preview: string
  validation: ProposalApplyValidation[]
  auditPath?: string
}

export interface Session {
  id: string
  title: string
  model: string
  systemPrompt: string
  sandbox?: SessionSandboxConfig | undefined
  loadedSkills?: string[] | undefined
  contextWindow?: ContextWindowState | undefined
  memory?: SessionMemoryState | undefined
  createdAt: string
  updatedAt: string
  messages: SessionMessage[]
}

export interface SessionSummary {
  id: string
  title: string
  model: string
  sandbox?: SessionSandboxConfig | undefined
  loadedSkills?: string[] | undefined
  contextWindow?: ContextWindowState | undefined
  memory?: SessionMemoryState | undefined
  createdAt: string
  updatedAt: string
  messageCount: number
  preview: string
  lastRole: string | null
}

export interface ContextWindowState {
  maxTokens: number
  rawTokens: number
  effectiveTokens: number
  rawUsageRatio: number
  effectiveUsageRatio: number
  rawUsagePercent: number
  effectiveUsagePercent: number
  compressionMode: 'none' | 'partial' | 'full'
  recentTurnsKept: number
  summarizedMessages: number
  originalMessageCount: number
  effectiveMessageCount: number
  summaryTokens: number
}

export interface SessionMemoryFailure {
  toolName: string
  inputPreview: string
  error: string
  resolved?: boolean
  at: string
}

export interface SessionMemoryState {
  summary: string
  goals: string[]
  decisions: string[]
  openItems: string[]
  userPreferences: string[]
  relevantFiles: string[]
  recentFailures: SessionMemoryFailure[]
  updatedAt: string
}

export interface SessionMessage {
  id: string
  role: 'user' | 'assistant'
  content: SessionMessageContent
  createdAt: string
}

export type SessionMessageContent = string | AgentContentBlock[]

export type AgentContentBlock = TextBlock | ImageBlock | ToolUseBlock | ToolResultBlock

export interface TextBlock {
  type: 'text'
  text: string
}

export interface ImageBlock {
  type: 'image'
  image: string
  mediaType?: string
  filename?: string
}

export interface ToolUseBlock {
  type: 'tool_use'
  id: string
  name: string
  input: Record<string, unknown>
}

export interface ToolResultBlock {
  type: 'tool_result'
  tool_use_id: string
  tool_name?: string
  content: string
  is_error: boolean
}

export interface RuntimeEvent {
  event: string
  data: unknown
  at: string
}

export interface MarketSourceRef {
  sourceName: string
  provider: string
  sourceUrl?: string
  licenseType: 'mock' | 'public' | 'licensed' | 'user_authorized'
  fetchedAt: string
  publishedAt?: string
  rawHash?: string
}

export interface QuoteSnapshot {
  symbol: string
  name?: string
  ts: string
  price: number
  change: number
  changePct: number
  open: number
  high: number
  low: number
  previousClose: number
  volume: number
  amount: number
  turnoverRate: number
  volumeRatio: number
  limitUp?: boolean
  limitDown?: boolean
  source: MarketSourceRef
}

export interface MarketBar {
  symbol: string
  ts: string
  timeframe: '1d' | '1mo' | '1y' | '1m' | '5m' | '15m' | '30m' | '60m'
  open: number
  high: number
  low: number
  close: number
  volume: number
  amount: number
  source: MarketSourceRef
}

export interface SectorHeat {
  sectorId: string
  sectorName: string
  ts: string
  changePct: number
  amount: number
  risingCount: number
  fallingCount: number
  limitUpCount: number
  leaderSymbols: string[]
  strengthScore: number
  diffusionScore: number
  persistenceScore: number
  riskScore: number
}

export interface MarketNarrative {
  id: string
  title: string
  content: string
  contentHash: string
  source: MarketSourceRef
  publishedAt?: string
  fetchedAt: string
  symbols: string[]
  sectors: string[]
  category: 'announcement' | 'news' | 'research' | 'social' | 'rumor' | 'user_note'
  confidenceScore: number
  catalystScore: number
  riskScore: number
  aiSummary: string
  evidenceIds: string[]
  contradictionIds: string[]
}

export interface InfluencerPost {
  id: string
  platform: 'taoguba'
  authorId: string
  authorName: string
  title?: string
  content: string
  sourceUrl: string
  publishedAt?: string
  fetchedAt: string
  symbols: string[]
  sectors: string[]
  engagement: {
    views?: number
    replies?: number
    likes?: number
    favorites?: number
  }
  stance?: 'bullish' | 'bearish' | 'neutral' | 'unclear'
  noveltyScore: number
  influenceScore: number
}

export interface MarketAlert {
  id: string
  level: 'info' | 'watch' | 'urgent'
  title: string
  message: string
  symbols: string[]
  sectors: string[]
  triggeredAt: string
  ruleId?: string
  sourceEventIds: string[]
  status: 'new' | 'seen' | 'dismissed' | 'resolved'
  aiRationale?: string
}

export interface TechnicalSignal {
  symbol: string
  ts: string
  timeframe: MarketBar['timeframe']
  trend: 'uptrend' | 'sideways' | 'downtrend'
  ma5: number
  ma10: number
  ma20: number
  atr14: number
  rsi6: number
  macd: {
    dif: number
    dea: number
    hist: number
  }
  support: number
  resistance: number
  volumeSignal: 'expanding' | 'normal' | 'shrinking'
  bars: MarketBar[]
  summary: string
  riskNotes: string[]
}

export interface HotStockSignal {
  id: string
  symbol: string
  name?: string
  rank: number
  score: number
  sourceName: string
  sourceUrl?: string
  sourceType: 'taoguba_search_hot' | 'taoguba_popularity_board' | 'taoguba_page'
  heatText: string
  reasons: string[]
  sectors: string[]
  mentionCount: number
  fetchedAt: string
  publishedAt?: string
  source: MarketSourceRef
}

export interface HotStockSourceStatus {
  enabled: boolean
  provider: string
  providerLabel: string
  mode: 'disabled' | 'agent_browser'
  sourceUrls: string[]
  fetchedAt?: string
  message?: string
  error?: string
}

export interface DragonTigerStock {
  id: string
  symbol: string
  name?: string
  latestListedAt: string
  closePrice: number
  changePct: number
  listingCount: number
  netBuyAmount: number
  buyAmount: number
  sellAmount: number
  totalAmount: number
  institutionBuyCount: number
  institutionSellCount: number
  institutionNetBuyAmount: number
  interpretation?: string
  listingReason?: string
  after1DayReturn?: number
  after2DayReturn?: number
  after5DayReturn?: number
  after10DayReturn?: number
  source: MarketSourceRef
}

export interface DragonTigerDailyStock {
  id: string
  rawIndex?: number
  tradeDate: string
  symbol: string
  name?: string
  closePrice: number
  changePct: number
  netBuyAmount: number
  buyAmount: number
  sellAmount: number
  totalAmount: number
  marketAmount: number
  netBuyRatio: number
  turnoverAmountRatio: number
  turnoverRate: number
  floatMarketCap: number
  interpretation?: string
  listingReason?: string
  after1DayReturn?: number
  after2DayReturn?: number
  after5DayReturn?: number
  after10DayReturn?: number
  raw?: Record<string, unknown>
  source: MarketSourceRef
}

export interface DragonTigerSeat {
  id: string
  symbol: string
  tradeDate: string
  side: 'buy' | 'sell'
  rank: number
  brokerName: string
  buyAmount: number
  buyAmountRatio: number
  sellAmount: number
  sellAmountRatio: number
  netAmount: number
  seatType: 'institution' | 'broker' | 'northbound' | 'unknown'
  reason?: string
  source: MarketSourceRef
}

export interface DragonTigerInstitutionSeat {
  id: string
  symbol: string
  name?: string
  closePrice: number
  changePct: number
  totalAmount: number
  listingCount: number
  institutionBuyAmount: number
  institutionBuyCount: number
  institutionSellAmount: number
  institutionSellCount: number
  institutionNetBuyAmount: number
  oneMonthChangePct: number
  source: MarketSourceRef
}

export interface DragonTigerBrokerTrade {
  id: string
  brokerCode?: string
  brokerName: string
  brokerShortName?: string
  tradeDate: string
  symbol: string
  name?: string
  changePct: number
  buyAmount: number
  sellAmount: number
  netAmount: number
  listingReason?: string
  after1DayReturn?: number
  after2DayReturn?: number
  after3DayReturn?: number
  after5DayReturn?: number
  after10DayReturn?: number
  after20DayReturn?: number
  after30DayReturn?: number
  source: MarketSourceRef
}

export interface MarketStatus {
  enabled: boolean
  provider: string
  providerLabel: string
  market: 'A_SHARE'
  phase: 'pre_market' | 'open' | 'lunch_break' | 'closed' | 'after_hours'
  tradingDay: string
  now: string
  quoteDelayMs: number
  dataMode: 'mock' | 'live'
  complianceMode: 'research_only'
}

export interface MarketWatchlist {
  id: string
  name: string
  symbols: string[]
  updatedAt: string
}

export interface MarketOverview {
  status: MarketStatus
  indices: QuoteSnapshot[]
  watchlist: MarketWatchlist
  quotes: QuoteSnapshot[]
  sectors: SectorHeat[]
  narratives: MarketNarrative[]
  influencerPosts: InfluencerPost[]
  alerts: MarketAlert[]
  technicals: TechnicalSignal[]
  hotStocks: HotStockSignal[]
  hotStockQuotes: QuoteSnapshot[]
  hotStockStatus: HotStockSourceStatus
  dragonTigerStocks: DragonTigerStock[]
}

export interface MarketReport {
  id: string
  kind: 'intraday' | 'close' | 'watchlist'
  generatedAt: string
  tradingDay: string
  provider: string
  title: string
  summary: string
  indexBrief: string[]
  sectorBrief: string[]
  watchlistBrief: string[]
  narrativeBrief: string[]
  technicalBrief: string[]
  alertBrief: string[]
  riskNotes: string[]
  followUps: string[]
  sourceRefs: MarketSourceRef[]
}

export interface RuntimeTimelineToolRecord {
  toolUseId: string
  toolName: string
  status: 'pending' | 'running' | 'done' | 'error'
  inputPreview?: string
  input?: Record<string, unknown>
  outputPreview?: string
  output?: string
}

export type RuntimeTimelineBlock =
  | {
      kind: 'assistant'
      id: string
      text: string
      step?: number
    }
  | {
      kind: 'tool'
      id: string
      record: RuntimeTimelineToolRecord
      step?: number
    }

export interface SessionSandboxConfig {
  workspaceRoot?: string
  readRoots?: string[]
}

export interface RunResult {
  id: string
  sessionId: string
  createdAt: string
  model: string
  steps: Array<{
    step: number
    stopReason: string | null
    assistantText: string
    toolUseCount: number
  }>
  finalText: string
  usage: Array<Record<string, unknown> | null>
  toolExecutions: Array<{
    toolUseId: string
    toolName: string
    isError: boolean
    output: string
  }>
  contextWindow?: ContextWindowState
}

export interface StreamCompleteData {
  ok: boolean
  reply: string
  session: Session
  run: RunResult
}

export type ScheduledJobSchedule =
  | { type: 'once'; runAt: string }
  | { type: 'interval'; everyMs: number }
  | { type: 'cron'; expression: string; timezone?: string }

export interface ScheduledJob {
  id: string
  name: string
  enabled: boolean
  targetSessionId?: string
  sessionTemplateId?: string
  message: string
  model?: string
  systemPrompt?: string
  sandbox?: SessionSandboxConfig | undefined
  loadedSkills?: string[] | undefined
  createNewSession?: boolean | undefined
  params?: Record<string, string | number | boolean> | undefined
  catchupPolicy?: 'none' | 'latest' | undefined
  retryPolicy?: {
    maxAttempts: number
    backoffMs: number
  } | undefined
  schedule: ScheduledJobSchedule
  nextRunAt: string | null
  lastRunAt?: string | null
  lastSuccessAt?: string | null
  lastFailureAt?: string | null
  overlapPolicy?: 'skip' | 'parallel'
  createdAt: string
  updatedAt: string
}

export interface ScheduledExecution {
  id: string
  jobId: string
  sessionId: string
  status: 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled'
  triggerType: 'schedule' | 'manual' | 'retry' | 'catchup'
  attempt: number
  startedAt?: string
  finishedAt?: string
  error?: string
  createdAt: string
  updatedAt: string
  result?: {
    reply: string
    runId: string
    toolExecutionCount: number
  }
}

export interface SchedulerStatus {
  enabled: boolean
  pollIntervalMs: number
  runningJobs: number
  jobCount: number
  nextWakeAt: string | null
  nextJobRunAt: string | null
}
