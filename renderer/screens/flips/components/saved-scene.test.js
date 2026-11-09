import {interpret, State} from 'xstate'
import {
  isLoadableScene,
  nextIdAfter,
  pathObject,
  pictureKey,
  savedScene,
  SAVED_SCENE_VERSION,
} from './image-editor-model'
import {flipMasterMachine} from '../machines'

const settle = () =>
  new Promise((resolve) => {
    setTimeout(resolve, 0)
  })

// A scene as the editor holds it: loaded images (`img`) beside their URLs.
function editorScene() {
  return {
    size: {width: 440, height: 330},
    background: {img: {kind: 'loaded'}, url: 'data:image/png;base64,BG'},
    objects: [
      {
        id: 'object-2',
        type: 'image',
        url: 'data:image/png;base64,A',
        img: {kind: 'loaded'},
        left: 100,
        top: 80,
        width: 160,
        height: 120,
        angle: 15,
        opacity: 1,
        scaleX: 1.5,
        scaleY: 0.5,
        brightness: 1.2,
      },
      pathObject(
        'object-7',
        [
          {x: 10, y: 10},
          {x: 40, y: 30},
        ],
        '#ff6666dd',
        20
      ),
    ],
  }
}

describe('savedScene (B-211)', () => {
  it('keeps every picture and stroke with its place, size, angle and brightness, without loaded images', () => {
    const saved = savedScene(editorScene(), () => undefined)
    expect(saved.version).toBe(SAVED_SCENE_VERSION)
    expect(saved.background).toBe('data:image/png;base64,BG')
    expect(saved.objects[0]).toEqual({
      id: 'object-2',
      type: 'image',
      url: 'data:image/png;base64,A',
      left: 100,
      top: 80,
      width: 160,
      height: 120,
      angle: 15,
      opacity: 1,
      scaleX: 1.5,
      scaleY: 0.5,
      brightness: 1.2,
    })
    expect(saved.objects[1].type).toBe('path')
    expect(saved.objects[1].points).toHaveLength(2)
    expect(JSON.parse(JSON.stringify(saved))).toEqual(saved)
    expect(isLoadableScene(JSON.parse(JSON.stringify(saved)))).toBe(true)
  })

  it('saves the compact copy of each picture and of the background when there is one', () => {
    const scene = editorScene()
    scene.objects[0].savedUrl = 'data:image/webp;base64,A'
    const saved = savedScene(scene, () => 'data:image/webp;base64,BG')
    expect(saved.background).toBe('data:image/webp;base64,BG')
    expect(saved.objects[0].url).toBe('data:image/webp;base64,A')
    expect(saved.objects[0]).not.toHaveProperty('savedUrl')
  })

  it('draws a background without URL (a crop) for its URL', () => {
    const scene = {...editorScene(), background: {img: {kind: 'cropped'}}}
    const saved = savedScene(scene, ({img}) => `drawn:${img.kind}`)
    expect(saved.background).toBe('drawn:cropped')
  })

  it('copies the strokes: a later change in the editor leaves the saved scene alone', () => {
    const scene = editorScene()
    const saved = savedScene(scene, () => '')
    scene.objects[1].points[0].x = 999
    expect(saved.objects[1].points[0].x).not.toBe(999)
  })
})

describe('isLoadableScene', () => {
  const good = () => savedScene(editorScene(), () => '')
  it.each([
    ['nothing', null],
    ['another version', {...good(), version: 2}],
    ['no size', {...good(), size: undefined}],
    ['a zero size', {...good(), size: {width: 0, height: 330}}],
    ['a background that is not a URL', {...good(), background: {}}],
    ['objects that are not a list', {...good(), objects: {}}],
    [
      'a picture without URL',
      {...good(), objects: [{id: 'object-1', type: 'image'}]},
    ],
    ['an unknown kind', {...good(), objects: [{id: 'object-1', type: 'text'}]}],
    [
      'a picture at a web address',
      {
        ...good(),
        objects: [
          {id: 'object-1', type: 'image', url: 'https://example.com/x.png'},
        ],
      },
    ],
    [
      'a background at a web address',
      {...good(), background: 'https://example.com/b.png'},
    ],
  ])('refuses %s', (_, value) => {
    expect(isLoadableScene(value)).toBe(false)
  })

  it('takes a scene without background or objects', () => {
    expect(
      isLoadableScene({
        version: SAVED_SCENE_VERSION,
        size: {width: 440, height: 330},
        background: null,
        objects: [],
      })
    ).toBe(true)
  })
})

describe('nextIdAfter and pictureKey', () => {
  it('gives the id after the highest one', () => {
    expect(nextIdAfter([{id: 'object-2'}, {id: 'object-7'}, {id: 'x'}])).toBe(8)
    expect(nextIdAfter([])).toBe(1)
  })

  it('tells two pictures apart, and the same picture alike', () => {
    expect(pictureKey('data:image/png;base64,AAAA')).toBe(
      pictureKey('data:image/png;base64,AAAA')
    )
    expect(pictureKey('data:image/png;base64,AAAA')).not.toBe(
      pictureKey('data:image/png;base64,AAAB')
    )
    expect(pictureKey(null)).toBeNull()
  })
})

describe('the flip master keeps each frame', () => {
  it('keeps the frame of a changed picture through Protect and back, and saves it with the draft', async () => {
    const persisted = []
    const machine = flipMasterMachine
      .withConfig({
        services: {
          loadKeywords: () => new Promise(() => {}),
          loadAdversarial: async () => {},
          persistFlip: (context, event) => () => {
            if (event.type === 'CHANGE_IMAGES') persisted.push(context)
          },
          protectFlip: async ({images}) => ({
            protectedImages: images.map((x) => x && `p-${x}`),
            adversarialImage: 'nonsense',
          }),
        },
      })
      .withContext({...flipMasterMachine.context, adversarialPlaced: true})
    const service = interpret(machine).start(
      machine.resolveState(
        State.from({editing: {keywords: 'loading'}}, machine.context)
      )
    )
    service.send('NEXT')
    await settle()
    const scene = {...savedScene(editorScene(), () => ''), picture: 'k'}
    service.send({
      type: 'CHANGE_IMAGES',
      image: 'flat-1',
      currentIndex: 1,
      scene,
    })
    await settle()
    expect(service.state.context.scenes[1]).toEqual(scene)
    expect(persisted.at(-1).scenes[1]).toEqual(scene)

    service.send('NEXT')
    await settle()
    service.send('PREV')
    await settle()
    expect(service.state.matches({editing: 'images'})).toBe(true)
    expect(service.state.context.scenes[1]).toEqual(scene)

    // A cleared frame drops its scene.
    service.send({
      type: 'CHANGE_IMAGES',
      image: null,
      currentIndex: 1,
      scene: null,
    })
    await settle()
    expect(service.state.context.scenes[1]).toBeNull()
    service.stop()
  })
})
