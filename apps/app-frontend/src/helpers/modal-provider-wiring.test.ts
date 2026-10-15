import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { runInNewContext } from 'node:vm'

import ts from 'typescript'

import { createModalHolds } from './modal-holds.ts'

type Holds = ReturnType<typeof createModalHolds>
type Viewer = Holds & {
	loadEditorData: (source: { path: string }) => Promise<{ source: Blob }>
}
type ViewerSetup = { setupImageViewerEditorProvider: (holds: Holds) => void }
type ProvidersSetup = {
	setupProviders: (
		client: unknown,
		manager: unknown,
		popup: unknown,
		events: unknown,
		holds: Holds,
	) => unknown
}

// Execute the actual provider sources; replace only UI registration and native/platform dependencies.
function loadProvider<T>(path: string, dependencies: Record<string, unknown>): T {
	const source = readFileSync(new URL(path, import.meta.url), 'utf8')
	const compiled = ts.transpileModule(source, {
		compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
	}).outputText
	const exports = {}
	runInNewContext(compiled, {
		exports,
		Blob,
		require: (id: string) => {
			assert.ok(Object.hasOwn(dependencies, id), `Unexpected provider dependency: ${id}`)
			return dependencies[id]
		},
	})
	return exports as T
}

function setup() {
	let locked = false
	let adsHolds = 0
	const holds = createModalHolds(
		() => {
			locked = true
			adsHolds++
		},
		() => {
			locked = false
			adsHolds--
		},
	)
	let viewer!: Viewer
	const imageViewer = loadProvider<ViewerSetup>('../providers/setup/image-viewer-editor.ts', {
		'@modrinth/ui': { provideImageViewerEditor: (context: Viewer) => (viewer = context) },
		'@tauri-apps/plugin-fs': { readFile: async () => new Uint8Array([1, 2, 3]) },
		'@/helpers/ads.js': {
			take_ads_window_hold: () => adsHolds++,
			release_ads_window_hold: () => adsHolds--,
		},
	})
	const providers = loadProvider<ProvidersSetup>('../providers/setup.ts', {
		'./setup/image-viewer-editor': imageViewer,
		'./onboarding-checklist': { setupOnboardingChecklistProvider: () => ({}) },
		'./setup/creation-modal': { setupCreationModal: () => ({}) },
		'./setup/file-drop': { setupFileDropProvider: () => undefined },
		'./setup/file-picker': { setupFilePickerProvider: () => undefined },
		'./setup/instance-import': { setupInstanceImportProvider: () => undefined },
		'./setup/tags': { setupTagsProvider: () => ({}) },
		'./setup/user-country': { setupUserCountryProvider: () => undefined },
	})
	providers.setupProviders({}, {}, {}, {}, holds)
	return { modal: holds, viewer, locked: () => locked, adsHolds: () => adsHolds }
}

test('provider wiring keeps scrollbar and ads locked when a modal closes before its viewer', () => {
	const h = setup()
	h.modal.onShow()
	h.viewer.onShow()
	h.modal.onHide()
	assert.equal(h.locked(), true)
	assert.equal(h.adsHolds(), 1)
	h.viewer.onHide()
	assert.equal(h.locked(), false)
	assert.equal(h.adsHolds(), 0)
})

test('provider wiring keeps scrollbar locked when viewer closes before the modal', () => {
	const h = setup()
	h.modal.onShow()
	h.viewer.onShow()
	h.viewer.onHide()
	assert.equal(h.locked(), true)
	assert.equal(h.adsHolds(), 1)
	h.modal.onHide()
	assert.equal(h.locked(), false)
	assert.equal(h.adsHolds(), 0)
})

test('viewer alone uses the shared lock and still loads image bytes', async () => {
	const h = setup()
	h.viewer.onShow()
	assert.equal(h.locked(), true)
	assert.equal(h.adsHolds(), 1)
	const data = await h.viewer.loadEditorData({ path: '/fixture.png' })
	assert.equal(data.source.type, 'image/png')
	assert.deepEqual([...new Uint8Array(await data.source.arrayBuffer())], [1, 2, 3])
	h.viewer.onHide()
	assert.equal(h.locked(), false)
	assert.equal(h.adsHolds(), 0)
})
