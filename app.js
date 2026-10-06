'use strict';

const STORAGE_KEY = 'shopping-list-v1';
const EMPTY_MESSAGE = 'You have everything — nothing to buy';
const $ = id => document.getElementById(id);
let entries = [];
let saved = false;

// A flat outline keeps original order, heading levels, and duplicate items.
function parseText(source) {
  const lines = source.replace(/\r\n?/g, '\n').split('\n').map(raw => {
    const indent = (raw.match(/^\s*/)[0].replace(/\t/g, '    ')).length;
    let text = raw.trim();
    if (!text || /^(?:-{3,}|\*{3,}|_{3,})$/.test(text)) return null;
    const heading = text.match(/^(#{1,})\s+(.+?)\s*#*$/);
    if (heading) return { type: 'heading', text: heading[2], level: heading[1].length, indent, explicit: true };
    const numbering = text.match(/^(\d+(?:\.\d+)*)([.)])?\s+/);
    const numberPath = numbering && (numbering[2] || numbering[1].includes('.')) ? numbering[1].split('.') : null;
    text = numberPath ? text.slice(numbering[0].length) : text.replace(/^[-*•]\s+/, '');
    const checkbox = text.match(/^\[([ xX])\]\s*(.*)$/);
    if (checkbox) text = checkbox[2];
    if (!text) return null;
    return { type: 'item', text, indent, checked: checkbox ? checkbox[1].toLowerCase() === 'x' : false, explicitCheck: !!checkbox, numberPath };
  }).filter(Boolean);
  let markdownLevel = 0;
  let categories = [];
  return lines.map((line, index) => {
    if (line.explicit) {
      markdownLevel = line.level;
      categories = [];
      return line;
    }
    const next = lines[index + 1];
    const numberedChild = line.numberPath && next?.numberPath && next.numberPath.length > line.numberPath.length && line.numberPath.every((part, i) => next.numberPath[i] === part);
    const isCategory = !line.explicitCheck && (/:$/.test(line.text) || numberedChild || (next && !next.explicit && next.indent > line.indent));
    while (categories.length && categories[categories.length - 1].indent >= line.indent) categories.pop();
    if (isCategory) {
      const level = markdownLevel + (numberedChild ? line.numberPath.length : categories.length + 1);
      categories.push({ indent: line.indent, level });
      return { type: 'heading', text: line.text.replace(/:$/, '').trim(), level, indent: line.indent };
    }
    return line;
  });
}

// Parse inert clipboard markup; never inject clipboard HTML into the page.
function htmlToText(html) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  doc.querySelectorAll('script,style,iframe,object,embed,svg,template,noscript').forEach(node => node.remove());
  const output = [];
  const inlineText = node => {
    if (node.nodeType === 3) return node.textContent;
    if (node.nodeType !== 1 || /^(UL|OL)$/.test(node.tagName)) return '';
    if (node.tagName === 'BR') return '\n';
    return Array.from(node.childNodes).map(inlineText).join('');
  };
  function walk(node, depth = 0) {
    if (node.nodeType === 3) {
      const text = node.textContent.trim();
      if (text) output.push(text);
      return;
    }
    if (node.nodeType !== 1) return;
    const heading = node.tagName.match(/^H([1-6])$/);
    if (heading || node.getAttribute('role') === 'heading') {
      const level = heading ? Number(heading[1]) : Math.max(1, Math.min(20, Number(node.getAttribute('aria-level')) || 1));
      const text = inlineText(node).trim();
      if (text) output.push(`${'#'.repeat(level)} ${text}`);
    } else if (node.tagName === 'LI') {
      const text = inlineText(node).trim();
      const nested = Array.from(node.children).filter(child => /^(UL|OL)$/.test(child.tagName));
      const check = node.querySelector('input[type="checkbox"]');
      if (text) output.push(`${'  '.repeat(depth)}- ${check ? `[${check.hasAttribute('checked') ? 'x' : ' '}] ` : ''}${text}${nested.length && !/:$/.test(text) ? ':' : ''}`);
      nested.forEach(list => walk(list, depth + 1));
    } else if (/^(UL|OL)$/.test(node.tagName)) {
      Array.from(node.children).forEach(child => walk(child, depth));
    } else if (!node.querySelector('h1,h2,h3,h4,h5,h6,ul,ol,p,div,section,article,table,[role="heading"]')) {
      const text = inlineText(node).trim();
      if (text) output.push(text);
    } else {
      Array.from(node.childNodes).forEach(child => walk(child, depth));
    }
  }
  walk(doc.body);
  return output.join('\n');
}

function outlineKeys(list) {
  const path = [];
  return list.map(entry => {
    if (entry.type === 'heading') {
      while (path.length && path[path.length - 1].level >= entry.level) path.pop();
      path.push(entry);
    }
    return JSON.stringify([path.map(h => h.text), entry.text]);
  });
}

function reconcile(next, previous) {
  const oldKeys = outlineKeys(previous);
  const newKeys = outlineKeys(next);
  const used = new Set();
  next.forEach((entry, i) => {
    if (entry.type !== 'item') return;
    let match = previous.findIndex((old, j) => !used.has(j) && old.type === 'item' && oldKeys[j] === newKeys[i]);
    if (match < 0) match = previous.findIndex((old, j) => !used.has(j) && old.type === 'item' && old.text === entry.text);
    if (match >= 0) {
      used.add(match);
      if (!entry.explicitCheck) entry.checked = previous[match].checked;
    }
  });
  return next;
}

function serialize(list) {
  return list.map(entry => entry.type === 'heading'
    ? `${'#'.repeat(entry.level)} ${entry.text}`
    : `${' '.repeat(entry.indent || 0)}- [${entry.checked ? 'x' : ' '}] ${entry.text}`).join('\n');
}

function shoppingText(list) {
  const included = new Set();
  const stack = [];
  list.forEach((entry, i) => {
    if (entry.type === 'heading') {
      while (stack.length && list[stack[stack.length - 1]].level >= entry.level) stack.pop();
      stack.push(i);
    } else if (!entry.checked) {
      included.add(i);
      stack.forEach(index => included.add(index));
    }
  });
  if (!included.size) return EMPTY_MESSAGE;
  return list.filter((_, i) => included.has(i)).map(entry => entry.type === 'heading'
    ? `${'#'.repeat(entry.level)} ${entry.text}`
    : `${' '.repeat(entry.indent || 0)}- ${entry.text}`).join('\n');
}

function notify(message) {
  $('notice').textContent = message;
  $('notice').hidden = !message;
}

function persist() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 1, entries }));
    notify('');
  } catch {
    notify('Your browser could not save this list. Changes are available for this session only.');
  }
}

function render() {
  $('editor').hidden = true;
  $('main-list').hidden = false;
  $('edit-button').hidden = false;
  const container = $('checklist');
  container.replaceChildren();
  const items = entries.filter(entry => entry.type === 'item');
  $('count').textContent = `${items.filter(entry => entry.checked).length} of ${items.length} at home`;
  if (!items.length) {
    const message = document.createElement('p');
    message.textContent = 'No items yet. Use Edit list to add some.';
    container.append(message);
  }
  entries.forEach(entry => {
    if (entry.type === 'heading') {
      const heading = document.createElement('div');
      heading.setAttribute('role', 'heading');
      heading.setAttribute('aria-level', entry.level);
      heading.className = 'category';
      heading.dataset.level = entry.level;
      heading.style.marginLeft = `${Math.min(entry.level - 1, 4) * 12}px`;
      heading.textContent = entry.text;
      container.append(heading);
      return;
    }
    const label = document.createElement('label');
    label.className = `item${entry.checked ? ' checked' : ''}`;
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = entry.checked;
    const text = document.createElement('span');
    text.textContent = entry.text;
    checkbox.addEventListener('change', () => {
      entry.checked = checkbox.checked;
      persist();
      label.classList.toggle('checked', entry.checked);
      $('count').textContent = `${items.filter(item => item.checked).length} of ${items.length} at home`;
      $('result').hidden = true;
    });
    label.append(checkbox, text);
    container.append(label);
  });
}

$('list-input').addEventListener('paste', event => {
  const html = event.clipboardData?.getData('text/html');
  if (!html) return;
  const text = htmlToText(html);
  if (!text) return;
  event.preventDefault();
  const input = $('list-input');
  input.setRangeText(text, input.selectionStart, input.selectionEnd, 'end');
});
$('save-button').addEventListener('click', () => {
  const next = parseText($('list-input').value);
  if (!next.length && !saved) {
    notify('Add a few items before saving your list.');
    $('list-input').focus();
    return;
  }
  entries = reconcile(next, entries);
  saved = true;
  persist();
  $('result').hidden = true;
  render();
});
$('edit-button').addEventListener('click', () => {
  $('list-input').value = serialize(entries);
  $('editor-title').textContent = 'Edit your list';
  $('editor').hidden = false;
  $('main-list').hidden = true;
  $('result').hidden = true;
  $('edit-button').hidden = true;
  $('cancel-button').hidden = false;
  $('list-input').focus();
});
$('cancel-button').addEventListener('click', render);
$('generate-button').addEventListener('click', () => {
  $('result-text').textContent = shoppingText(entries);
  $('copy-status').textContent = '';
  $('result').hidden = false;
  $('result').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
});
$('copy-button').addEventListener('click', async () => {
  const text = $('result-text').textContent;
  try {
    if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
    await navigator.clipboard.writeText(text);
    $('copy-status').textContent = 'Copied to clipboard.';
  } catch {
    const field = document.createElement('textarea');
    field.value = text;
    field.style.position = 'fixed';
    field.style.opacity = '0';
    document.body.append(field);
    field.select();
    let copied = false;
    try { copied = document.execCommand('copy'); } catch { /* Offer manual copying below. */ }
    field.remove();
    $('copy-button').focus();
    $('copy-status').textContent = copied ? 'Copied to clipboard.' : 'Copy is unavailable. Select the text above and copy it manually.';
  }
});

try {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (raw) {
    const data = JSON.parse(raw);
    if (data.version !== 1 || !Array.isArray(data.entries) || !data.entries.every(entry =>
      entry && typeof entry.text === 'string' &&
      ((entry.type === 'heading' && Number.isInteger(entry.level) && entry.level > 0 && entry.level <= 100) ||
       (entry.type === 'item' && typeof entry.checked === 'boolean' && Number.isInteger(entry.indent) && entry.indent >= 0 && entry.indent <= 1000)))) {
      throw new Error('Invalid saved list');
    }
    entries = data.entries;
    saved = true;
    render();
  }
} catch {
  notify('The saved list could not be loaded. Paste your list to start again.');
}
