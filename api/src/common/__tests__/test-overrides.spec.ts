import { overrideBase, testOverridesAllowed } from '../config/test-overrides';

describe('test-overrides — lista de permissão por NODE_ENV', () => {
  it('só development e test liberam o override', () => {
    expect(testOverridesAllowed({ NODE_ENV: 'development' })).toBe(true);
    expect(testOverridesAllowed({ NODE_ENV: 'test' })).toBe(true);
    for (const e of ['production', 'staging', '', undefined]) expect(testOverridesAllowed({ NODE_ENV: e })).toBe(false);
    expect(testOverridesAllowed(undefined)).toBe(false);
  });
  it('overrideBase usa o padrão quando bloqueado e tira a barra final', () => {
    expect(overrideBase({ NODE_ENV: 'test' }, 'http://127.0.0.1:1/x/', 'https://real/')).toBe('http://127.0.0.1:1/x');
    expect(overrideBase({ NODE_ENV: 'production' }, 'http://127.0.0.1:1', 'https://real/')).toBe('https://real');
    expect(overrideBase({}, 'http://127.0.0.1:1', 'https://real')).toBe('https://real');
    expect(overrideBase({ NODE_ENV: 'test' }, undefined, 'https://real')).toBe('https://real');
  });
});
