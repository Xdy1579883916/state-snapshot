import { parse, stringify } from 'flatted'
import { hashFunc } from './hash'

export interface IHistoryOptions<T = any> {
  /**
   * 用于优化数据转换的可选规则数组
   */
  rules?: ITransformRule<T>[]

  /**
   * 可选的初始状态
   */
  initialState?: T

  /**
   * push操作的防抖时间(毫秒)，默认50ms
   */
  delay?: number

  /**
   * 最大历史记录数量，默认100
   */
  maxLength?: number

  /**
   * 是否将状态数据序列化为chunks，默认true
   */
  useChunks?: boolean

  /**
   * 状态变更时的回调函数
   */
  onChange?: (state: T) => void
}

export interface ITransformRule<T = any> {
  /**
   * 判断规则是否匹配
   */
  match: (state: T) => boolean

  /**
   * 将状态拆分为可共享的chunks
   */
  toRecord: (state: T) => {
    chunks: any[]
    children?: any[]
  }

  /**
   * 将chunks重组为状态节点
   */
  fromRecord: (record: { chunks: any[], children?: any[] }) => T
}

export const defaultRule: ITransformRule = {
  match: () => true,
  toRecord: node => ({
    chunks: [node],
    children: Array.isArray(node.children) ? node.children : undefined,
  }),
  fromRecord: ({ chunks, children }) => ({
    ...chunks[0],
    ...(children ? { children } : {}),
  }),
}

function noop() {
}

export class History<T = any> {
  private readonly rules: ITransformRule[]
  private readonly delay: number
  private readonly maxLength: number
  private readonly useChunks: boolean
  private readonly onChange: (state: T) => void
  private index: number
  private records: Record<string, any>[] | null[]
  private chunks: Record<string, string>
  private pending: {
    state: T | null
    pickIndex: number | null
    onResolves: ((history: History<T>) => void)[]
    timer: number | null
  }

  private debounceTime: number | null

  constructor(options: IHistoryOptions<T> = {}) {
    this.rules = options.rules || []
    this.delay = options.delay || 50
    this.maxLength = options.maxLength || 100
    this.useChunks = options.useChunks ?? true
    this.onChange = noop

    this.index = -1
    this.records = []
    this.chunks = {}

    this.pending = {
      state: null,
      pickIndex: null,
      onResolves: [],
      timer: null,
    }
    this.debounceTime = null

    if (options.initialState !== undefined) {
      this.pushSync(options.initialState)
    }
    if (options.onChange) {
      this.onChange = options.onChange
    }
  }

  get hasRedo(): boolean {
    if (this.index === this.records.length - 1)
      return false
    return this.records.slice(this.index + 1).some(record => record !== null)
  }

  get hasUndo(): boolean {
    const lowerBound = Math.max(this.records.length - this.maxLength, 0)
    return this.index > lowerBound
  }

  get length(): number {
    return Math.min(this.records.length, this.maxLength)
  }

  private state2Record(state: T, prevRecord: Record<string, any> | null = null, pickIndex = -1): Record<string, any> {
    const ruleIndex = this.rules.findIndex(({ match }) => match(state))
    const rule = this.rules[ruleIndex] || defaultRule

    const { chunks, children } = rule.toRecord(state)
    const hashes: string[] = []

    chunks.forEach((chunk) => {
      const chunkStr = stringify(chunk)!
      const hashKey = hashFunc(chunkStr)
      hashes.push(String(hashKey))
      this.chunks[hashKey] = chunkStr
    })

    if (pickIndex !== -1 && Array.isArray(prevRecord?.children)) {
      const childrenCopy = [...prevRecord!.children]
      childrenCopy[pickIndex] = this.state2Record(children![pickIndex], null)
      return { hashes, ruleIndex, children: childrenCopy }
    }

    return {
      hashes,
      ruleIndex,
      children: children?.map(node => this.state2Record(node)),
    }
  }

  private record2State(record: Record<string, any>): T {
    const { hashes, ruleIndex, children } = record
    const chunks = hashes.map(hash => parse(this.chunks[hash]))
    const rule = this.rules[ruleIndex] || defaultRule

    return rule.fromRecord({
      chunks,
      children: children?.map(node => this.record2State(node)),
    })
  }

  get(): T {
    const currentRecord = this.records[this.index]
    let resultState: T

    if (!currentRecord) {
      resultState = null as unknown as T
    }
    else if (!this.useChunks) {
      resultState = currentRecord as T
    }
    else {
      resultState = this.record2State(currentRecord)
    }

    this.onChange(resultState)
    return resultState
  }

  pushSync(state: T, pickIndex = -1): History<T> {
    const latestRecord = this.records[this.index] || null
    const record = this.useChunks
      ? this.state2Record(state, latestRecord, pickIndex)
      : state

    this.index++
    this.records[this.index] = record!

    // Clear redo records
    this.records.splice(this.index + 1)

    // Clear first valid record if max length reached
    if (this.index >= this.maxLength) {
      this.records[this.index - this.maxLength] = null
    }

    // Clear pending state
    if (this.pending.timer) {
      clearTimeout(this.pending.timer)
      this.pending.state = null
      this.pending.pickIndex = null
      this.pending.timer = null
      this.debounceTime = null
      this.pending.onResolves.forEach(resolve => resolve(this))
      this.pending.onResolves = []
    }

    this.onChange(state)
    return this
  }

  push(state: T, pickIndex = -1): Promise<History<T>> {
    const currentTime = Date.now()

    const setupPending = () => {
      this.pending.state = state
      this.pending.pickIndex = pickIndex
      this.debounceTime = currentTime

      return new Promise<History<T>>((resolve) => {
        this.pending.onResolves.push(resolve)
        this.pending.timer = setTimeout(() => {
          this.pushSync(this.pending.state!, this.pending.pickIndex!)
        }, this.delay) as any
      })
    }

    if (this.pending.timer === null) {
      return setupPending()
    }
    else if (currentTime - (this.debounceTime || 0) < this.delay) {
      clearTimeout(this.pending.timer)
      this.pending.timer = null
      return setupPending()
    }

    return Promise.reject(new Error('Invalid push operation'))
  }

  undo(): History<T> {
    if (this.hasUndo)
      this.index--
    return this
  }

  redo(): History<T> {
    if (this.hasRedo)
      this.index++
    return this
  }

  reset(): History<T> {
    this.index = -1
    this.records = []
    this.chunks = {}

    if (this.pending.timer) {
      clearTimeout(this.pending.timer)
    }

    this.pending = {
      state: null,
      pickIndex: null,
      onResolves: [],
      timer: null,
    }
    this.debounceTime = null

    return this
  }
}

export {
  hashFunc,
}
