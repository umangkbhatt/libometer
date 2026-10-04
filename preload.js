const { contextBridge, ipcRenderer } = require('electron');
const allowed = [
  'settings:get', 'settings:set',
  'courses:list', 'courses:import', 'courses:delete', 'courses:setGroup',
  'groups:list', 'groups:add', 'groups:delete',
  'videos:list', 'videos:progress', 'videos:toggle', 'videos:addLinks', 'videos:reorder', 'videos:resetOrder', 'videos:delete', 'courses:createCustom',
  'notes:list', 'notes:add', 'notes:delete',
  'stats:get', 'stats:addTime',
];
contextBridge.exposeInMainWorld('api', {
  invoke: (channel, ...args) => {
    if (!allowed.includes(channel)) throw new Error('Blocked channel: ' + channel);
    return ipcRenderer.invoke(channel, ...args);
  },
});
