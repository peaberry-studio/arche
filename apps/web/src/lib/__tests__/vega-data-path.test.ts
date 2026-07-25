import { describe, expect, it } from 'vitest'

import { isAbsoluteUri, resolveWorkspaceDataPath, workspaceDataUrl } from '@/lib/vega-data-path'

describe('resolveWorkspaceDataPath', () => {
  it('normalizes workspace-relative paths', () => {
    expect(resolveWorkspaceDataPath('data/latency.csv')).toBe('data/latency.csv')
    expect(resolveWorkspaceDataPath('/data/latency.csv')).toBe('data/latency.csv')
    expect(resolveWorkspaceDataPath('./data//latency.csv')).toBe('data/latency.csv')
    expect(resolveWorkspaceDataPath('Research/run-1/metrics.json')).toBe('Research/run-1/metrics.json')
  })

  it('refuses paths that climb out of the workspace', () => {
    expect(resolveWorkspaceDataPath('../secrets.env')).toBeNull()
    expect(resolveWorkspaceDataPath('data/../../etc/passwd')).toBeNull()
    expect(resolveWorkspaceDataPath('/../../etc/passwd')).toBeNull()
  })

  it('refuses empty paths', () => {
    expect(resolveWorkspaceDataPath('')).toBeNull()
    expect(resolveWorkspaceDataPath('   ')).toBeNull()
    expect(resolveWorkspaceDataPath('/')).toBeNull()
  })
})

describe('isAbsoluteUri', () => {
  it('detects absolute URIs that must not be treated as workspace paths', () => {
    for (const uri of ['https://example.com/x.csv', 'http://x', 'data:image/png;base64,AA', 'file:///etc/passwd']) {
      expect(isAbsoluteUri(uri)).toBe(true)
    }
  })

  it('treats workspace-relative values as relative', () => {
    for (const uri of ['data/latency.csv', '/data/latency.csv', './x.json', 'a/b/c.tsv']) {
      expect(isAbsoluteUri(uri)).toBe(false)
    }
  })
})

describe('workspaceDataUrl', () => {
  it('builds a same-origin URL against the workspace file route', () => {
    expect(workspaceDataUrl('my-space', 'data/latency.csv'))
      .toBe('/api/w/my-space/files/download?path=data%2Flatency.csv&chart=1')
  })

  it('encodes slugs and paths', () => {
    expect(workspaceDataUrl('a b', 'dir name/file .csv'))
      .toBe('/api/w/a%20b/files/download?path=dir%20name%2Ffile%20.csv&chart=1')
  })
})

describe('scheme normalization is shared with the sanitizer', () => {
  it('classifies control-character-obfuscated URIs the same way policy does', () => {
    // A laxer second copy would let `da\tta:` read as relative here while the sanitizer
    // read it as `data:` — the value would then be collected as a workspace file path.
    for (const uri of ['da\tta:image/png;base64,AA', ' javascript:alert(1)', 'ht\ntps://example.com']) {
      expect(isAbsoluteUri(uri)).toBe(true)
    }
  })

  it('still treats genuinely relative paths as relative', () => {
    for (const uri of ['data/latency.csv', './a.json', 'a:b/c'.replace('a:b', 'ab')]) {
      expect(isAbsoluteUri(uri)).toBe(false)
    }
  })
})
