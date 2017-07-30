'use strict'

const {
	isObject,
	isArray,
} = require('util')

const {
	readFile: FSReadFile,
	writeFile: FSWriteFile,
} = require('fs')

const {
	resolve: PathResolve,
} = require('path')

const Pug = require('pug')
const Pretty = require('pretty')
const SymLinkDir = require('symlink-dir')
const MKDirP = require('mkdirp')
const Yaml = require('yaml-js')

function readFile(filename) {
	return new Promise((resolve, reject) => {
		FSReadFile(filename, (err, data) => {
			if (err)
				return reject(err)
			resolve(data)
		})
	})
}

function writeFile(filename, data) {
	return MakeDir(PathResolve(filename, '..'))
	.then(() =>
		new Promise((resolve, reject) => {
			FSWriteFile(filename, data, err => {
				if (err)
					return reject(err)
				resolve()
			})
		})
	)
}

function MakeDir(path) {
	return new Promise((resolve, reject) => {
		MKDirP(path, err => {
			if (err)
				return reject(err)
			resolve()
		})
	})
}

class ConfigReader {
	constructor() {
		this.types = new Map
		this.cache = new WeakMap
	}

	registerType(typename, handler) {
		this.types.set(typename, handler)
	}

	process(config, path, root, filename) {
		if (isObject(config)) {
			if (this.cache.has(config))
				return this.cache.get(config)
			const result = this._process(config, path, root, filename)
			this.cache.set(config, result)
			return result
		}
		return this._process(config, path, root, filename)
	}

	_process(config, path = [], root = config, filename) {
		if (isArray(config))
			return Promise.all(
				config.map(
					(value, index) => this.process(value, path.concat(index), root, filename)
				)
			)
		
		if (isObject(config)) {
			const result = {}
			const queue = []
			for (let key of Object.keys(config))
				queue.push(
					this.process(config[key], path.concat(key), root, filename)
						.then(res => result[key] = res)
				)
			return Promise.all(queue)
				.then(() => {
					if (
						result.hasOwnProperty('type')
						&&
						this.types.has(result.type)
					)
						return new Promise(
							resolve => resolve(
								this.types.get(result.type)(result, path, root, filename, this)
							)
						)
					return result
				})
		}

		return Promise.resolve(config)
	}

	read(filename) {
		return readFile(filename)
			.then(buf => {
				const config = Yaml.load(buf.toString())
				return this.process(config, [], config, filename)
			})
	}
}

function throwIfNotHasOwnProperty(object, path, root, filename, typename, property) {
	if (!object.hasOwnProperty(property))
		throw new Error(
			`Config object with type "${
				typename
			}" must contain "${
				property
			}" field.\nError found at ${
				JSON.stringify(path)
			} of ${
				filename ? filename : JSON.stringify(root)
			}`
		)
}

function PugTemplateType(object, path, root, filename, reader) {
	throwIfNotHasOwnProperty(object, path, root, filename, 'pug-template', 'template')
	let g = Promise.resolve({})
	if ((path[0] !== 'globalParameters') && (root.hasOwnProperty('globalParameters')))
		g = reader.process(root.globalParameters)
	return g.then(global => {
		const template = PathResolve('.', object.template)
		const parameters = {global}
		if (object.hasOwnProperty('parameters'))
			Object.assign(parameters, object.parameters)
		const html = Pug.renderFile(template, parameters)
		if (root.hasOwnProperty('prettyHTML') && root.prettyHTML)
			return Pretty(html)
		else
			return html
				.replace(/\n/g, '')
				.replace(/\r/g, '')
	})
}

const reader = new ConfigReader
reader.registerType('pug-template', PugTemplateType)

async function main() {
	const configPromise = reader.read('config.yaml')
	const config = await configPromise
	const queue = []
	for (const url of Object.keys(config.pages))
		queue.push(writeFile(
			PathResolve('.', 'build', url),
			config.pages[url]
		))
	await SymLinkDir('static', 'build/static')
	await Promise.all(queue)
	console.log('Building complete!')
}

main()
.catch(err => {
	console.error(`Error!\n${err.stack}`)
})