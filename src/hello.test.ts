import { describe, it, expect, vi } from 'vitest'
import { hello } from './hello.js'

describe('hello', () => {
  it('logs a greeting', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {})
    hello()
    expect(spy).toHaveBeenCalledWith('Hello claudeflow!')
    spy.mockRestore()
  })
})
