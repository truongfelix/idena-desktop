import {noteBlocks} from './release-note'

describe('a release note', () => {
  it('joins the lines a note wraps by hand', () => {
    expect(
      noteBlocks(
        'Community build of the app. It runs on the same\nIdena network.'
      )
    ).toEqual([
      {
        type: 'text',
        text: 'Community build of the app. It runs on the same Idena network.',
      },
    ])
  })

  it('shows headings, list items and code lines', () => {
    const note = [
      "## What's new",
      '',
      '- **Linux**: download `idena.deb`, then run',
      '  `sudo apt install ./idena.deb`.',
      '- Windows: run the [installer](https://example.com).',
      '',
      '```',
      'e027ea20  idena.deb',
      '```',
    ].join('\n')
    expect(noteBlocks(note)).toEqual([
      {type: 'heading', text: "What's new"},
      {
        type: 'item',
        text: 'Linux: download idena.deb, then run sudo apt install ./idena.deb.',
      },
      {type: 'item', text: 'Windows: run the installer (https://example.com).'},
      {type: 'code', text: 'e027ea20  idena.deb'},
    ])
  })

  it('is empty without a note', () => {
    expect(noteBlocks('')).toEqual([])
    expect(noteBlocks(null)).toEqual([])
  })
})
