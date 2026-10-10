import { createSession, play, validateSession } from './engine.mjs';
self.onmessage = ({ data }) => {
  try {
    const result = data.action === 'create' ? createSession(data.text, data.rule, data.gameIndex) : data.action === 'restore' ? validateSession(data.session) : play(data.state, data.input);
    self.postMessage({ id: data.id, result });
  } catch (error) { self.postMessage({ id: data.id, error: error.message }); }
};
