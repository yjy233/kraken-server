/**
 * ReActAgent —— ReAct 循环 Agent 类
 *
 * 职责：管理多轮"推理 → 行动 → 观察"循环。
 * 每次循环委托 loopQuery 执行单轮模型调用+工具执行，
 * 直到模型不再请求工具，或达到最大步数限制。
 */

import crypto from 'node:crypto'
import { loopQuery } from './loop-query.js'
import type { AgentMessage, ReActAgentConfig, RunResult, RunStep, EmitFn, RunAgentRequestResult, ToolDefinition } from './types.js'

export class ReActAgent {
  constructor(private config: ReActAgentConfig) {}

  /**
   * 启动一次完整的 ReAct 运行。
   * @param params.messages      初始上下文消息（通常已包含最新 user message）
   * @param params.model         本次运行指定的模型（可选，默认使用构造配置）
   * @param params.systemPrompt  本次运行指定的系统提示词（可选）
   * @param params.emit          SSE 事件发射器（可选）
   * @returns reply: 最终文本回复；run: 运行记录；finalMessages: 包含完整对话的新消息数组
   */
  async run(params: {
    messages: AgentMessage[]
    model?: string
    systemPrompt?: string
    tools?: ToolDefinition[] | undefined
    emit?: EmitFn | undefined
  }): Promise<RunAgentRequestResult & { finalMessages: AgentMessage[] }> {
    const model = params.model || this.config.defaultModel
    const systemPrompt = params.systemPrompt || this.config.defaultSystemPrompt
    const emit = params.emit
    const tools = params.tools || this.config.toolRegistry

    // 初始化运行记录
    const run: RunResult = {
      id: crypto.randomUUID(),
      sessionId: '',
      createdAt: new Date().toISOString(),
      model,
      steps: [],
      finalText: '',
      usage: [],
      toolExecutions: [],
    }

    let currentMessages = [...params.messages]

    emit?.('run:start', { runId: run.id, model, maxAgentSteps: this.config.maxSteps })

    // ReAct 主循环
    for (let stepIndex = 0; stepIndex < this.config.maxSteps; stepIndex += 1) {
      emit?.('run:step', { runId: run.id, step: stepIndex + 1, phase: 'model_request' })

      // 委托单轮查询
      const loopParams: Parameters<typeof loopQuery>[0] = {
        messages: currentMessages,
        model,
        systemPrompt,
        tools,
        maxOutputTokens: this.config.maxTokens,
        step: stepIndex + 1,
        emit,
      }
      if (this.config.timeout !== undefined) {
        loopParams.timeout = this.config.timeout
      }
      const result = await loopQuery(loopParams)

      // 收集本轮运行数据
      const step: RunStep = {
        step: stepIndex + 1,
        stopReason: result.stopReason,
        assistantText: result.assistantText,
        toolUseCount: result.toolUseCount,
      }
      run.steps.push(step)
      run.usage.push(result.usage)
      run.toolExecutions.push(...result.toolExecutions)

      currentMessages = result.updatedMessages

      // 模型不再请求工具 → 拿到最终答案，结束循环
      if (result.done) {
        const finalText = result.assistantText || 'The model returned without text.'
        run.finalText = finalText
        return { reply: finalText, run, finalMessages: currentMessages }
      }
    }

    // 达到最大步数限制，返回兜底消息
    const exhaustedMessage = `Agent stopped after reaching the maximum step limit (${this.config.maxSteps}).`
    run.finalText = exhaustedMessage
    return { reply: exhaustedMessage, run, finalMessages: currentMessages }
  }
}
