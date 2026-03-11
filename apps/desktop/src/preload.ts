import { contextBridge } from 'electron'

contextBridge.exposeInMainWorld('arche', {
  platform: process.platform,
  isDesktop: true,
})
