import * as container from './docker-container'
import * as local from './docker-local'
import { getSpawnerBackend } from './config'

export type ExecResult = container.ExecResult

function implementation() {
  return getSpawnerBackend() === 'local' ? local : container
}

export function createContainer(...args: Parameters<typeof container.createContainer>) {
  return implementation().createContainer(...args)
}

export function startContainer(...args: Parameters<typeof container.startContainer>) {
  return implementation().startContainer(...args)
}

export function stopContainer(...args: Parameters<typeof container.stopContainer>) {
  return implementation().stopContainer(...args)
}

export function removeContainer(...args: Parameters<typeof container.removeContainer>) {
  return implementation().removeContainer(...args)
}

export function inspectContainer(...args: Parameters<typeof container.inspectContainer>) {
  return implementation().inspectContainer(...args)
}

export function isContainerRunning(...args: Parameters<typeof container.isContainerRunning>) {
  return implementation().isContainerRunning(...args)
}

export function isOpencodeHealthy(...args: Parameters<typeof container.isOpencodeHealthy>) {
  return implementation().isOpencodeHealthy(...args)
}

export function execInContainer(...args: Parameters<typeof container.execInContainer>) {
  return implementation().execInContainer(...args)
}
