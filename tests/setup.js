// Mock browser extension globals so background.js can be required in Node
global.browser = {
  runtime: {
    onInstalled: { addListener: jest.fn() },
    onMessage:   { addListener: jest.fn() },
    getURL:      jest.fn(p => `chrome-extension://test/${p}`),
    openOptionsPage: jest.fn(),
  },
  action:  { onClicked: { addListener: jest.fn() } },
  alarms:  { create: jest.fn(), onAlarm: { addListener: jest.fn() } },
  storage: {
    local: {
      get: jest.fn(() => Promise.resolve({})),
      set: jest.fn(() => Promise.resolve()),
    },
    sync: {
      get: jest.fn(() => Promise.resolve({})),
      set: jest.fn(() => Promise.resolve()),
    },
  },
  notifications: { create: jest.fn() },
  tabs:    { create: jest.fn() },
};
