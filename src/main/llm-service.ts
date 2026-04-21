import { AIMessage, HumanMessage, SystemMessage, type BaseMessage, type MessageContent } from '@langchain/core/messages'
import { ChatOpenAI } from '@langchain/openai'
import type { AppConfig, QueryAiRequest, QueryAiStats } from '../shared/types'

export class LlmService {
  async chatToShell(
    request: QueryAiRequest,
    config: AppConfig,
    onToken: (token: string) => void | Promise<void>
  ): Promise<{ answer: string; stats: QueryAiStats }> {
    this.applyLangSmithTracing(config)
    const provider = config.settings.llm.provider === 'deepseek' ? 'deepseek' : 'openai'
    const startedAt = Date.now()
    const hasKey = config.settings.llm.apiKey && !config.settings.llm.apiKey.includes('xxxxx')
    if (!hasKey) {
      const fallback = this.fallback(request.input)
      await onToken(fallback)
      return {
        answer: fallback,
        stats: {
          durationMs: Date.now() - startedAt,
          estimatedTokens: this.estimateTokens(request.input, fallback),
          provider,
          model: config.settings.llm.model
        }
      }
    }

    try {
      const model = this.createModel(config)
      const messages = this.buildMessages(request)
      const chunks = await model.stream(messages)
      let merged = ''
      let tokenUsage: { inputTokens?: number; outputTokens?: number; totalTokens?: number } | undefined
      for await (const chunk of chunks) {
        tokenUsage = this.readUsageFromChunk(chunk) || tokenUsage
        const text = this.chunkToText(chunk.content)
        if (!text) continue
        merged += text
        await onToken(text)
      }
      const normalized = this.normalizeAnswer(merged)
      if (!normalized) {
        const fallback = this.fallback(request.input)
        await onToken(fallback)
        return {
          answer: fallback,
          stats: {
            durationMs: Date.now() - startedAt,
            estimatedTokens: this.estimateTokens(request.input, fallback),
            provider,
            model: config.settings.llm.model
          }
        }
      }
      return {
        answer: normalized,
        stats: {
          durationMs: Date.now() - startedAt,
          inputTokens: tokenUsage?.inputTokens,
          outputTokens: tokenUsage?.outputTokens,
          totalTokens: tokenUsage?.totalTokens,
          estimatedTokens:
            typeof tokenUsage?.totalTokens === 'number' ? undefined : this.estimateTokens(this.messagesText(messages), normalized),
          provider,
          model: config.settings.llm.model
        }
      }
    } catch {
      const fallback = this.fallback(request.input)
      await onToken(fallback)
      return {
        answer: fallback,
        stats: {
          durationMs: Date.now() - startedAt,
          estimatedTokens: this.estimateTokens(request.input, fallback),
          provider,
          model: config.settings.llm.model
        }
      }
    }
  }

  private createModel(config: AppConfig): ChatOpenAI {
    const provider = config.settings.llm.provider === 'deepseek' ? 'deepseek' : 'openai'
    const endpoint =
      String(config.settings.llm.endpoint || '').trim() || (provider === 'deepseek' ? 'https://api.deepseek.com/v1' : '')
    return new ChatOpenAI({
      model: config.settings.llm.model,
      apiKey: config.settings.llm.apiKey,
      temperature: 0.1,
      maxRetries: 1,
      timeout: 20_000,
      streamUsage: false,
      configuration: endpoint ? { baseURL: endpoint } : undefined
    })
  }

  private buildMessages(request: QueryAiRequest): BaseMessage[] {
    const trimmedSessionLogs = request.sessionLogs.slice(-120)
    const trimmedQueryOutput = request.queryOutputLines.slice(-80)
    const trimmedHistory = request.history.slice(-20)
    const contextLines = [
      request.selectedCommand ? `当前会话命令: ${request.selectedCommand}` : '当前会话命令: 未选择',
      request.targetLogPath?.trim() ? `目标日志路径: ${request.targetLogPath.trim()}` : '目标日志路径: 未提供',
      '',
      '最近终端会话输出（节选）:',
      ...trimmedSessionLogs,
      '',
      '最近分析命令输出（节选）:',
      ...trimmedQueryOutput
    ]
    const messages: BaseMessage[] = [
      new SystemMessage(
        '你是 Shell 日志分析助手。你必须只输出一条可直接执行的单行 shell 命令，不要解释、不要 Markdown、不要代码块。你可以利用上下文日志与历史对话持续优化命令。'
      ),
      new HumanMessage(contextLines.join('\n'))
    ]
    for (const item of trimmedHistory) {
      if (!item.content.trim()) continue
      if (item.role === 'assistant') messages.push(new AIMessage(item.content))
      else messages.push(new HumanMessage(item.content))
    }
    messages.push(new HumanMessage(request.input))
    return messages
  }

  private chunkToText(content: MessageContent): string {
    if (typeof content === 'string') return content
    if (!Array.isArray(content)) return ''
    return content
      .map((part) => {
        if (typeof part === 'string') return part
        if (part.type === 'text' && typeof part.text === 'string') return part.text
        return ''
      })
      .join('')
  }

  private normalizeAnswer(text: string): string {
    const line = text
      .replace(/```[\s\S]*?```/g, '')
      .split(/\r?\n/)
      .map((item) => item.trim())
      .find((item) => item.length > 0)
    return line || ''
  }

  private readUsageFromChunk(chunk: unknown): { inputTokens?: number; outputTokens?: number; totalTokens?: number } | undefined {
    const payload = chunk as {
      usage_metadata?: { input_tokens?: number; output_tokens?: number; total_tokens?: number }
      response_metadata?: { tokenUsage?: { promptTokens?: number; completionTokens?: number; totalTokens?: number } }
    }
    const usage = payload.usage_metadata
    if (usage && (usage.input_tokens || usage.output_tokens || usage.total_tokens)) {
      return {
        inputTokens: usage.input_tokens,
        outputTokens: usage.output_tokens,
        totalTokens: usage.total_tokens
      }
    }
    const compat = payload.response_metadata?.tokenUsage
    if (compat && (compat.promptTokens || compat.completionTokens || compat.totalTokens)) {
      return {
        inputTokens: compat.promptTokens,
        outputTokens: compat.completionTokens,
        totalTokens: compat.totalTokens
      }
    }
    return undefined
  }

  private messagesText(messages: BaseMessage[]): string {
    return messages
      .map((message) => (typeof message.content === 'string' ? message.content : ''))
      .join('\n')
      .slice(-12_000)
  }

  private estimateTokens(input: string, output: string): number {
    // Rough heuristic for CJK + English mixed text.
    return Math.max(1, Math.ceil((input.length + output.length) / 3))
  }

  private fallback(input: string): string {
    if (input.includes('支付') || input.includes('失败')) return 'grep -iE "pay.*fail|支付.*失败" /var/log/app.log | tail -n 50'
    if (input.includes('内存')) return "free -m | awk 'NR==2 {print $3\"/\"$2}'"
    if (input.includes('容器')) return 'docker stats --no-stream'
    return `echo "${input.replace(/"/g, '\\"')}"`
  }

  private applyLangSmithTracing(config: AppConfig): void {
    const ls = config.settings.langsmith
    if (!ls || !ls.tracingV2) return
    process.env.LANGCHAIN_TRACING_V2 = 'true'
    if (ls.endpoint && ls.endpoint.trim()) process.env.LANGCHAIN_ENDPOINT = ls.endpoint.trim()
    if (ls.apiKey && ls.apiKey.trim()) process.env.LANGCHAIN_API_KEY = ls.apiKey.trim()
    if (ls.project && ls.project.trim()) process.env.LANGCHAIN_PROJECT = ls.project.trim()
  }
}
