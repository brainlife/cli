'use strict';

// Plain-text rendering of the aimport plan and result for the terminal (no colors).

const MAX_LINE = 160;
const MAX_ISSUES = 20;
const ENTITY_ORDER = ['task', 'acq', 'ce', 'rec', 'dir', 'run', 'echo', 'part'];

function clip(line, max = MAX_LINE) {
    line = String(line).replace(/[\r\n]+/g, ' ');
    return line.length > max ? line.slice(0, max - 3) + '...' : line;
}

function bidsName(entry) {
    const parts = ['sub-' + entry.subject];
    if (entry.session) parts.push('ses-' + entry.session);
    const ents = entry.entities || {};
    for (const key of ENTITY_ORDER) {
        if (ents[key] !== undefined && ents[key] !== null && ents[key] !== '') parts.push(key + '-' + ents[key]);
    }
    parts.push(entry.suffix || 'unknown');
    return parts.join('_');
}

function statusText(entry) {
    if (entry.exclude) return 'excluded: ' + (entry.reason || entry.status || 'excluded');
    if (entry.status === 'ok') return 'ok';
    return entry.status === 'unknown' || !entry.status ? 'unknown' : entry.status;
}

function defaceText(entry) {
    if (entry.deface_opt_out) return 'opted out';
    return entry.deface ? 'yes' : 'no';
}

function pad(rows) {
    const widths = [];
    for (const row of rows) row.forEach((cell, i) => widths[i] = Math.max(widths[i] || 0, String(cell).length));
    return rows.map(row => row.map((cell, i) => i === row.length - 1 ? String(cell) : String(cell).padEnd(widths[i])).join('  '));
}

function renderPlan(plan, opts = {}) {
    const target = (opts && opts.target) || plan.target || 'bids';
    const withBl = target === 'datatypes';
    const header = ['#', 'BIDS name'];
    if (withBl) header.push('brainlife datatype');
    header.push('deface', 'status', 'source');
    const entries = plan.entries || [];
    // pad the main columns, then interleave the notes
    const rows = [header];
    entries.forEach((e, i) => {
        const row = [String(i + 1), (e.datatype ? e.datatype + '/' : '') + bidsName(e)];
        if (withBl) row.push(e.brainlife_datatype || '-');
        row.push(defaceText(e), statusText(e), (e.source || 'none') + ' ' + Number(e.confidence || 0).toFixed(2));
        rows.push(row);
    });
    const lines = pad(rows).map(l => clip(l));
    const out = [lines[0]];
    entries.forEach((e, i) => {
        out.push(lines[i + 1]);
        if (e.agent_note) out.push(clip('      note: ' + e.agent_note));
    });
    out.push('');
    out.push('Dataset name: ' + plan.dataset_name);
    out.push('Deface method: ' + plan.deface_method);
    const warnings = plan.warnings || [];
    if (warnings.length) {
        out.push('');
        for (const w of warnings) out.push(clip('! ' + w));
    }
    const anc = plan.ancillary || [];
    if (anc.length) {
        out.push('');
        out.push('Ancillary files:');
        const arows = anc.map(a => [a.path, a.action, (a.flags || []).join(', ')]);
        for (const l of pad(arows)) out.push(clip('  ' + l.trimEnd()));
    }
    return out.join('\n') + '\n';
}

function renderResult(status) {
    const out = [];
    out.push('Stage: ' + status.stage + (status.message ? ' (' + status.message + ')' : ''));
    if (status.output_dir) out.push('Output folder: ' + status.output_dir);
    const v = status.validation;
    if (v) {
        const errors = v.errors || [];
        const warnings = v.warnings || [];
        const ec = v.error_count !== undefined ? v.error_count : errors.length;
        const wc = v.warning_count !== undefined ? v.warning_count : warnings.length;
        out.push(`Validation: ${ec} error(s), ${wc} warning(s)`);
        const issues = errors.map(i => ['error', i]).concat(warnings.map(i => ['warning', i]));
        for (const [sev, i] of issues.slice(0, MAX_ISSUES)) {
            const files = (i.files || []).slice(0, 3).join(', ');
            out.push(clip(`  ${sev} ${i.code || ''}: ${i.message || ''}${files ? ' [' + files + ']' : ''}`));
        }
        if (issues.length > MAX_ISSUES) out.push(`  ... and ${issues.length - MAX_ISSUES} more`);
    }
    return out.join('\n') + '\n';
}

module.exports = {renderPlan, renderResult, bidsName};
