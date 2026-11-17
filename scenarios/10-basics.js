// The basics. Every parser should get all of these right; if one does not, the
// harness or the adapter is the first suspect.

import { git, lines } from './_dsl.js';

const c = `#include <stdio.h>

static int helper(int value)
{
	int doubled = value * 2;
	int tripled = value * 3;
	return doubled + tripled;
}

int main(void)
{
	int total = 0;
	total += helper(1);
	total += helper(2);
	total += helper(3);
	printf("%d\\n", total);
	return 0;
}
`;

export const scenarios = [
  git('basics/modify-one-line', {
    title: 'One line changed in the middle of a file',
    tags: ['basics'],
    before: { 'greeting.txt': 'hello\nworld\ngoodbye\n' },
    after: { 'greeting.txt': 'hello\nthere\ngoodbye\n' },
  }),
  git('basics/add-file', {
    title: 'A new file',
    why: 'The old side is /dev/null and the hunk header reads "-0,0".',
    tags: ['basics', 'added'],
    before: { 'keep.txt': 'keep\n' },
    after: { 'keep.txt': 'keep\n', 'new.txt': 'first\nsecond\nthird\n' },
  }),
  git('basics/delete-file', {
    title: 'A deleted file',
    why: 'The new side is /dev/null and the hunk header reads "+0,0".',
    tags: ['basics', 'deleted'],
    before: { 'keep.txt': 'keep\n', 'old.txt': 'first\nsecond\nthird\n' },
    after: { 'keep.txt': 'keep\n' },
  }),
  git('basics/two-hunks', {
    title: 'Two hunks in one file',
    tags: ['basics'],
    before: { 'numbers.txt': lines(30) },
    after: { 'numbers.txt': lines(30, (i) => (i === 3 ? 'three' : i === 27 ? 'twenty-seven' : String(i))) },
  }),
  git('basics/three-files', {
    title: 'Three files: one modified, one added, one deleted',
    tags: ['basics', 'added', 'deleted'],
    before: { 'a.txt': 'alpha\n', 'b.txt': 'beta\n', 'c.txt': 'gamma\n' },
    after: { 'a.txt': 'ALPHA\n', 'c.txt': 'gamma\n', 'd.txt': 'delta\n' },
  }),
  git('basics/prepend-and-append', {
    title: 'Lines added at the very top and the very bottom',
    tags: ['basics'],
    before: { 'list.txt': lines(12) },
    after: { 'list.txt': `zero\n${lines(12)}thirteen\n` },
  }),
  git('basics/single-line-file', {
    title: 'A count of 1 is left out of the hunk header',
    why: '"@@ -1 +1 @@" means "@@ -1,1 +1,1 @@". A parser that defaults a missing count to 0, or that treats an explicit 0 as missing, miscounts.',
    tags: ['basics', 'hunk-header'],
    before: { 'one.txt': 'before\n' },
    after: { 'one.txt': 'after\n' },
  }),
  git('basics/section-heading', {
    title: 'Text after the closing @@ is the enclosing function, not content',
    tags: ['basics', 'hunk-header'],
    before: { 'main.c': c },
    after: { 'main.c': c.replace('total += helper(3);', 'total += helper(4);') },
  }),
  git('basics/blank-context-lines', {
    title: 'An empty context line is spelled as a single space',
    tags: ['basics', 'blank-lines'],
    before: { 'poem.txt': 'one\n\ntwo\n\nthree\n\nfour\n' },
    after: { 'poem.txt': 'one\n\ntwo\n\nTHREE\n\nfour\n' },
  }),
  git('basics/blank-added-and-deleted-lines', {
    title: 'Adding or deleting an empty line gives a bare "+" or "-"',
    why: 'The whole diff line is one character long. Parsers that skip "empty-looking" lines or trim lines lose them.',
    tags: ['basics', 'blank-lines'],
    before: { 'spacing.txt': 'a\n\n\nb\nc\nd\n' },
    after: { 'spacing.txt': 'a\nb\nc\n\n\nd\n' },
  }),
  git('basics/whitespace-only-lines', {
    title: 'Lines made of spaces and tabs',
    tags: ['basics', 'whitespace'],
    before: { 'ws.txt': 'start\n  \n\t\n \t \nend\n' },
    after: { 'ws.txt': 'start\n    \n\t\t\n \t \nend\n' },
  }),
  git('basics/indentation-preserved', {
    title: 'Leading and trailing whitespace is content',
    tags: ['basics', 'whitespace'],
    before: { 'indent.py': 'def f():\n    return 1\n\ndef g():\n\treturn 2   \n' },
    after: { 'indent.py': 'def f():\n        return 1\n\ndef g():\n\treturn 2\n' },
  }),
  git('basics/large-line-numbers', {
    title: 'A change far down a long file',
    tags: ['basics', 'hunk-header'],
    before: { 'long.txt': lines(20000) },
    after: { 'long.txt': lines(20000, (i) => (i === 19990 ? 'changed' : String(i))) },
  }),
  git('basics/many-hunks', {
    title: 'Ten hunks in one file',
    tags: ['basics'],
    before: { 'grid.txt': lines(200) },
    after: { 'grid.txt': lines(200, (i) => (i % 20 === 10 ? `row ${i}` : String(i))) },
  }),
  git('basics/empty-diff', {
    title: 'Nothing changed: the diff is empty',
    why: 'Zero bytes of input must give zero files, not an exception and not one empty file.',
    tags: ['basics', 'empty-input'],
    before: { 'same.txt': 'same\n' },
    after: { 'same.txt': 'same\n' },
  }),
];
