import { describe, expect, it, vi } from 'vitest'
import { History } from '../src'

function getState(): any {
  return {
    id: 0,
    name: 'root',
    children: [
      { id: 1, name: 'a', children: [] },
      { id: 2, name: 'b', children: [] },
      {
        id: 3,
        name: 'c',
        children: [
          { id: 4, name: 'd', children: [] },
          { id: 5, name: 'e', children: [] },
        ],
      },
    ],
  }
}

describe('history', () => {
  it('初始化History实例', () => {
    const history = new History()
    const state = getState()
    history.pushSync(state)
    expect(history.get()).toEqual(state)
  })

  it('支持初始状态', () => {
    const state = getState()
    const history = new History({ initialState: state })
    expect(history.get()).toEqual(state)
  })

  it('正确处理撤销/重做标志', () => {
    const history = new History()
    expect(history.hasUndo).toBeFalsy()
    expect(history.hasRedo).toBeFalsy()

    const state = getState()
    history.pushSync(state)
    expect(history.hasUndo).toBeFalsy()
    expect(history.hasRedo).toBeFalsy()

    history.pushSync(state)
    expect(history.hasUndo).toBeTruthy()
    expect(history.hasRedo).toBeFalsy()

    history.undo()
    expect(history.hasUndo).toBeFalsy()
    expect(history.hasRedo).toBeTruthy()

    history.redo()
    expect(history.hasUndo).toBeTruthy()
    expect(history.hasRedo).toBeFalsy()
  })

  it('支持撤销操作', () => {
    const history = new History()
    const state = getState()
    history.pushSync(state)
    state.name = 'x'
    history.pushSync(state)
    state.name = 'y'
    history.pushSync(state)

    expect(history.get().name).toEqual('y')
    expect(history.undo().get().name).toEqual('x')
    expect(history.undo().get().name).toEqual('root')
  })

  it('处理冗余的API调用', () => {
    const history = new History()
    const state = getState()
    history.pushSync(state)
    state.name = 'x'
    history.pushSync(state)
    state.name = 'y'
    history.pushSync(state)

    history.undo().undo().undo().undo().undo()
    expect(history.get().name).toEqual('root')
    expect(history.hasUndo).toBeFalsy()

    history.redo().redo().redo().redo().redo()
    expect(history.get().name).toEqual('y')
    expect(history.hasRedo).toBeFalsy()
  })

  it('支持最大长度限制', () => {
    const history = new History({ maxLength: 5 })
    const state = getState()

    for (let i = 0; i < 10; i++) {
      history.pushSync(state)
    }
    expect(history.hasUndo).toBeTruthy()
    expect(history.hasRedo).toBeFalsy()
    expect(history.length).toEqual(5)

    for (let i = 0; i < 5; i++) {
      history.undo()
    }
    expect(history.hasUndo).toBeFalsy()
    expect(history.hasRedo).toBeTruthy()
  })

  it('支持异步push操作', () => {
    const history = new History({ delay: 5 })
    const state = getState()

    for (let i = 0; i < 100; i++) {
      history.push(state)
    }
    expect(history.get()).toBeNull()

    return new Promise(
      resolve => setTimeout(resolve, 10),
    ).then(() => {
      expect(history.get()).toEqual(state)
    })
  })

  it('支持状态变更回调', () => {
    const onChange = vi.fn<any>(() => {})
    const history = new History({ onChange, delay: 0 })
    const state = getState()
    history.pushSync(state)
    expect(onChange.mock.calls.length).toBe(1)
    expect(onChange.mock.calls[0][0]).toEqual(state)
    const newState = { ...state, name: 'root-changed' }
    history.push(newState)
    return history.push(newState).then(() => { // simulate calls to be debounced
      expect(onChange.mock.calls.length).toBe(2)
      history.get()
      expect(onChange.mock.calls.length).toBe(3)
      history.undo().get()
      expect(onChange.mock.calls[3][0]).toEqual(state)
      history.redo().get()
      expect(onChange.mock.calls.length).toBe(5)
      expect(onChange.mock.calls[4][0]).toEqual(newState)
    })
  })

  it('初始状态不触发回调', () => {
    const onChange = vi.fn(() => {})
    const state = getState()
    const his = new History({ initialState: state, onChange })
    expect(onChange.mock.calls.length).toBe(0)
  })

  it('支持禁用chunks', () => {
    const history = new History({ useChunks: false })
    const state1 = getState()
    const state2 = getState()
    history.pushSync(state1)
    history.pushSync(state2)
    expect(history.get()).toEqual(state2)
    expect(history.undo().get()).toEqual(state1)
  })

  it('支持自定义转换规则', () => {
    const state = {
      type: 'container',
      elements: [
        { type: 'image', left: 100, top: 100, image: 'foo' },
        { type: 'image', left: 200, top: 200, image: 'bar' },
        { type: 'image', left: 300, top: 300, image: 'baz' },
      ],
    }

    const rules = [
      {
        match: ({ type }) => type === 'image',
        toRecord: node => ({
          chunks: [
            { ...node, image: undefined },
            node.image,
          ],
        }),
        fromRecord: ({ chunks }) => ({
          ...chunks[0],
          image: chunks[1],
        }),
      },
      {
        match: ({ type }) => type === 'container',
        toRecord: node => ({
          chunks: [{ ...node, elements: undefined }],
          children: node.elements,
        }),
        fromRecord: ({ chunks, children }) => ({
          ...chunks[0],
          data: chunks[1],
          elements: children,
        }),
      },
    ]

    const history = new History({ rules })
    history.pushSync(state)
    expect(history.get()).toEqual(state)
  })

  it('自定义转换规则-边缘异常', () => {
    const state = {
      type: 'container',
      data: undefined,
      elements: [
        {
          type: 'container',
          data: null,
        },
      ],
    }

    const rules = [
      {
        match: ({ type }) => type === 'container',
        toRecord: (node) => {
          const { elements, data, ...other } = node

          return {
            chunks: [
              other,
              data, // 当data不存在的时候会发生异常
            ],
            children: elements,
          }
        },
        fromRecord: ({ chunks, children }) => ({
          ...chunks[0],
          data: chunks[1],
          elements: children,
        }),
      },
    ]

    const history = new History({ rules })
    history.pushSync(state)
    expect(history.get()).toEqual(state)
  })

  it('支持循环引用结构', () => {
    const parent: any = { children: [], name: 'foo' }
    const child = { parent, name: 'boo' }
    parent.children.push(child)
    const state = { parent }

    const history = new History()
    history.pushSync(state)
    const result = history.get()
    expect(result.parent.name).toEqual(parent.name)
    expect(result.parent.children[0].name).toEqual(child.name)
  })
})
