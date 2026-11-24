'use strict';

const {describe, it} = require('node:test');
const assert = require('node:assert');
const {renderPlan, renderResult, bidsName} = require('../aimport/plan-table');
const plan = require('./fixtures/aimport-plan.json');

describe('aimport plan table', () => {
    it('bidsName orders entities by schema', () => {
        assert.strictEqual(bidsName({subject: '01', session: '1', entities: {run: '1', task: 'rest'}, suffix: 'bold'}),
            'sub-01_ses-1_task-rest_run-1_bold');
        assert.strictEqual(bidsName({subject: '02', session: null, entities: {}, suffix: 'T1w'}), 'sub-02_T1w');
    });

    it('renders entries, statuses, notes, warnings and ancillary files', () => {
        const text = renderPlan(plan, {target: 'datatypes'});
        assert.ok(text.includes('anat/sub-01_ses-1_T1w'));
        assert.ok(text.includes('opted out'));
        assert.ok(text.includes('excluded: field map magnitude not needed'));
        assert.ok(text.includes('unknown'));
        assert.ok(text.includes('agent 0.92'));
        assert.ok(text.includes('neuro/anat/t1w'));
        assert.ok(text.includes('Agent suggests task-rest'));
        assert.ok(text.includes('Synthetic example dataset') && text.includes('pydeface'));
        for (const w of plan.warnings) assert.ok(text.includes('! ' + w));
        for (const a of plan.ancillary) assert.ok(text.includes(a.path));
        for (const l of text.split('\n')) assert.ok(l.length <= 160);
    });

    it('shows the brainlife column only for datatypes', () => {
        assert.ok(!renderPlan(plan, {target: 'bids'}).includes('neuro/anat/t1w'));
    });

    it('clips long lines', () => {
        const p = JSON.parse(JSON.stringify(plan));
        p.warnings = ['x'.repeat(400)];
        for (const l of renderPlan(p, {target: 'bids'}).split('\n')) assert.ok(l.length <= 160);
    });

    it('renders the result with at most 20 issues', () => {
        const errors = Array.from({length: 25}, (_, i) => ({code: 'E' + i, severity: 'error', message: 'bad', files: ['a.json']}));
        const text = renderResult({stage: 'invalid', message: '25 validation error(s)', output_dir: '/work/output/bids',
            validation: {ok: false, error_count: 25, warning_count: 1, errors, warnings: [{code: 'W1', message: 'meh', files: []}]}});
        assert.ok(text.includes('invalid') && text.includes('/work/output/bids'));
        assert.ok(text.includes('25 error(s), 1 warning(s)'));
        assert.strictEqual(text.split('\n').filter(l => /^  error E/.test(l)).length, 20);
        assert.ok(text.includes('and 6 more'));
    });
});
