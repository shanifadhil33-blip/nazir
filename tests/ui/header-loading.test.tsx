import { expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { messagesFor } from '../../src/components/ocean/copy';
import { helpLine, whoFor } from '../../src/components/shell/people';
import { ChecksView } from '../../src/components/shell/checks';
import { homeLinks } from '../../src/components/shell/home-model';

const copy = messagesFor('en');
it('names no one while loading and the person is not known', () => {
  expect(whoFor(undefined, 'viewer', copy, true)).toEqual({ initials: '', name: '', full: '' });
  expect(helpLine('', copy, true)).toBe('');
});
it('keeps the person and the workspace once they are known, and the defaults when not loading', () => {
  expect(whoFor({ initials: 'YH', name: 'Yusuf' }, 'editor', copy, true)).toEqual({ initials: 'YH', name: 'Yusuf', full: 'Yusuf' });
  expect(whoFor(undefined, 'viewer', copy, false).name).toBe(copy.shell.ahmed);
  expect(helpLine('Nazir demo', copy, true)).toBe('');
  expect(helpLine('', copy, false)).toBe(copy.agentStatus.none);
});
it('a loading Checks page shows no other person or made up desk', () => {
  const html = renderToStaticMarkup(<ChecksView lang="en" seat="editor" phase="loading" checks={[]} access={{ start: true, stop: false, suggest: false }} assistant="" links={homeLinks('w1')} now={new Date()} openId={null} openQuestion={null} running={null} busy={null} note={null} />);
  expect(html).not.toContain('Ahmed');
  expect(html).not.toContain(copy.shell.helpDesk);
});
