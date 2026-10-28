import { describe, expect, it } from 'vitest';
import { isNetMessage } from '../src/network/protocol';

describe('联机消息协议', () => {
  it('接受已知消息类型', () => {
    expect(isNetMessage({ type: 'move', from: 'e2', to: 'e4' })).toBe(true);
    expect(isNetMessage({ type: 'undo-request' })).toBe(true);
    expect(isNetMessage({ type: 'welcome', hostColor: 'w', state: {} })).toBe(true);
  });

  it('拒绝未知或非对象消息', () => {
    expect(isNetMessage(null)).toBe(false);
    expect(isNetMessage('move')).toBe(false);
    expect(isNetMessage({ type: 'evil' })).toBe(false);
  });
});
