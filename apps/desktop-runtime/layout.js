'use strict'

const { join } = require('path')

const {
  DEFAULT_NEW_VAULT_NAME,
  DESKTOP_KB_CONFIG_DIR_NAME,
  DESKTOP_KB_CONTENT_DIR_NAME,
  DESKTOP_OPENCODE_RUNTIME_DIR_NAME,
  DESKTOP_RUNTIME_DIR_NAME,
  DESKTOP_SECRETS_DIR_NAME,
  DESKTOP_USERS_DIR_NAME,
  DESKTOP_WORKSPACE_DIR_NAME,
} = require('./constants')

function getDesktopKbConfigDir(vaultPath) {
  return join(vaultPath, DESKTOP_KB_CONFIG_DIR_NAME)
}

function getDesktopKbContentDir(vaultPath) {
  return join(vaultPath, DESKTOP_KB_CONTENT_DIR_NAME)
}

function getDesktopRuntimeDir(vaultPath) {
  return join(vaultPath, DESKTOP_RUNTIME_DIR_NAME)
}

function getDesktopRuntimeDataDir(vaultPath) {
  return join(getDesktopRuntimeDir(vaultPath), DESKTOP_OPENCODE_RUNTIME_DIR_NAME)
}

function getDesktopWorkspaceDir(vaultPath) {
  return join(vaultPath, DESKTOP_WORKSPACE_DIR_NAME)
}

function getDesktopWorkspaceAttachmentsDir(vaultPath) {
  return join(getDesktopWorkspaceDir(vaultPath), '.arche', 'attachments')
}

function getDesktopSecretsDir(vaultPath) {
  return join(vaultPath, DESKTOP_SECRETS_DIR_NAME)
}

function getDesktopUsersDir(vaultPath) {
  return join(vaultPath, DESKTOP_USERS_DIR_NAME)
}

function getDesktopUserDataDir(vaultPath, slug) {
  return join(getDesktopUsersDir(vaultPath), slug)
}

module.exports = {
  DEFAULT_NEW_VAULT_NAME,
  getDesktopKbConfigDir,
  getDesktopKbContentDir,
  getDesktopRuntimeDir,
  getDesktopRuntimeDataDir,
  getDesktopWorkspaceDir,
  getDesktopWorkspaceAttachmentsDir,
  getDesktopSecretsDir,
  getDesktopUsersDir,
  getDesktopUserDataDir,
}
