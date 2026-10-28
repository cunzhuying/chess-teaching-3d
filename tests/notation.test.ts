import { describe, expect, it } from 'vitest';
import { formatMoveZh, pieceValueLabel, sideNameZh } from '../src/domain/notation';

describe('中文教学记谱', () => {
  it('兵的前进与吃子', () => {
    expect(formatMoveZh({ piece: 'p', from: 'e2', to: 'e4', flags: 'b' })).toBe('兵 e2→e4');
    expect(
      formatMoveZh({ piece: 'p', from: 'e4', to: 'd5', captured: 'p', flags: 'c' }),
    ).toBe('兵 e4×d5');
  });

  it('马、象、车、后、王都带起点', () => {
    expect(formatMoveZh({ piece: 'n', from: 'g1', to: 'f3', flags: 'n' })).toBe('马 g1→f3');
    expect(formatMoveZh({ piece: 'b', from: 'f1', to: 'c4', flags: 'n' })).toBe('象 f1→c4');
    expect(formatMoveZh({ piece: 'r', from: 'a1', to: 'd1', flags: 'n' })).toBe('车 a1→d1');
    expect(formatMoveZh({ piece: 'q', from: 'd1', to: 'h5', flags: 'n' })).toBe('后 d1→h5');
    expect(formatMoveZh({ piece: 'k', from: 'e1', to: 'e2', flags: 'n' })).toBe('王 e1→e2');
  });

  it('王车易位', () => {
    expect(formatMoveZh({ piece: 'k', from: 'e1', to: 'g1', flags: 'k' })).toBe('短易位');
    expect(formatMoveZh({ piece: 'k', from: 'e1', to: 'c1', flags: 'q' })).toBe('长易位');
  });

  it('升变、吃过路兵、将军、将死', () => {
    expect(
      formatMoveZh({ piece: 'p', from: 'e7', to: 'e8', promotion: 'q', flags: 'p' }),
    ).toBe('兵 e7→e8=后');
    expect(
      formatMoveZh({ piece: 'p', from: 'e7', to: 'd8', captured: 'r', promotion: 'n', flags: 'cp' }),
    ).toBe('兵 e7×d8=马');
    expect(
      formatMoveZh({ piece: 'p', from: 'e5', to: 'd6', captured: 'p', flags: 'e' }),
    ).toBe('兵 e5×d6（吃过路兵）');
    expect(
      formatMoveZh({ piece: 'q', from: 'd1', to: 'h5', flags: 'n', isCheck: true }),
    ).toBe('后 d1→h5＋');
    expect(
      formatMoveZh({ piece: 'q', from: 'd1', to: 'h5', flags: 'n', isMate: true }),
    ).toBe('后 d1→h5＃');
  });

  it('教学标签', () => {
    expect(pieceValueLabel('q')).toBe('9');
    expect(pieceValueLabel('k')).toBe('—');
    expect(sideNameZh('w')).toBe('白方');
    expect(sideNameZh('b')).toBe('黑方');
  });
});
