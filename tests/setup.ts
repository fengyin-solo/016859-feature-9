import { beforeAll, afterAll, afterEach } from 'vitest'

// Mock localStorage（兼容 node 与 jsdom 环境）
const localStorageMock = (() => {
  let store: Record<string, string> = {}
  return {
    getItem: (key: string) => (Object.prototype.hasOwnProperty.call(store, key) ? store[key] : null),
    setItem: (key: string, value: string) => {
      store[key] = String(value)
    },
    removeItem: (key: string) => {
      delete store[key]
    },
    clear: () => {
      store = {}
    },
  }
})()

const target: { localStorage?: typeof localStorageMock } =
  typeof globalThis !== 'undefined'
    ? (globalThis as typeof globalThis & { localStorage?: typeof localStorageMock })
    : ({} as { localStorage?: typeof localStorageMock })

if (!target.localStorage) {
  Object.defineProperty(target, 'localStorage', {
    value: localStorageMock,
    configurable: true,
  })
}

// jsdom 下同时挂到 window
if (typeof window !== 'undefined') {
  Object.defineProperty(window, 'localStorage', {
    value: localStorageMock,
    configurable: true,
  })
}

beforeAll(() => {
  // Setup before all tests
})

afterEach(() => {
  // Clear localStorage after each test
  localStorage.clear()
})

afterAll(() => {
  // Cleanup after all tests
})
