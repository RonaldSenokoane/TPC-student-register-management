import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { PDFDocument } from 'pdf-lib';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import JSZip from 'jszip';
import { proofFilename, proofFilenames } from '../public/dashboard/proof-documents.js';

function pageText(content) {
    const lines = [];
    let current = '';
    let previousY;
    for (const item of content.items) {
        if (!('str' in item)) continue;
        const y = Math.round(item.transform[5]);
        if (previousY !== undefined && Math.abs(y - previousY) > 3) {
            lines.push(current);
            current = '';
        }
        current += ` ${item.str}`;
        previousY = y;
        if (item.hasEOL) { lines.push(current); current = ''; previousY = undefined; }
    }
    lines.push(current);
    return lines.join('\n');
}

export async function inspectCombinedPdf(bytes, mapping = []) {
    const task = getDocument({ data: new Uint8Array(bytes), useSystemFonts: true, isEvalSupported: false });
    const pdf = await task.promise;
    const pages = [];
    try {
        for (let number = 1; number <= pdf.numPages; number++) {
            const page = await pdf.getPage(number);
            const text = pageText(await page.getTextContent());
            const names = [...text.matchAll(/Full\s+Name\s*:\s*([\s\S]+?)(?=Student\s+Number\s*:|ID\s*\/\s*Passport\s+Number\s*:|$)/gi)]
                .map(match => match[1].replace(/\s+/g, ' ').trim());
            const ids = [...text.matchAll(/Student\s+Number\s*:\s*([^\r\n]+)/gi)]
                .map(match => match[1].replace(/\s+/g, ' ').trim());
            const ambiguous = names.length > 1 || ids.length > 1;
            pages.push({ page: number, name: names[0] || '', firstNames: '', surname: '', studentId: ids[0] || '',
                reason: ambiguous ? 'Multiple student labels on one page; cannot safely separate this page.' : '', ambiguous });
        }
    } finally { await task.destroy(); }
    const known = new Map();
    pages.filter(page => page.name && page.studentId && !page.ambiguous).forEach(page => {
        const existing = known.get(page.studentId);
        known.set(page.studentId, known.has(page.studentId) && existing !== page.name ? null : page.name);
    });
    for (const page of pages) {
        const reviewed = mapping.find(entry => entry.page === page.page && entry.reviewed === true);
        if (page.ambiguous) continue;
        if (reviewed) {
            if (!reviewed.name?.trim() || !reviewed.studentId?.trim()) throw new Error(`Reviewed mapping for page ${page.page} requires name and studentId.`);
            if ((page.name && page.name !== reviewed.name.trim()) || (page.studentId && page.studentId !== reviewed.studentId.trim())) {
                throw new Error(`Mapping contradicts the certificate on page ${page.page}. Check the source PDF.`);
            }
            page.name = reviewed.name.trim();
            page.studentId = reviewed.studentId.trim();
            if (reviewed.firstNames?.trim() && reviewed.surname?.trim()) {
                const normalize = value => value.trim().replace(/\s+/g, ' ').toLowerCase();
                if (normalize(`${reviewed.firstNames} ${reviewed.surname}`) !== normalize(page.name)) {
                    throw new Error(`Given names and surname do not match the certificate name on page ${page.page}.`);
                }
                page.firstNames = reviewed.firstNames.trim();
                page.surname = reviewed.surname.trim();
            }
        }
        if (!page.name && page.studentId && known.get(page.studentId)) page.name = known.get(page.studentId);
        if (!page.name || !page.studentId) page.reason = 'Page ownership is uncertain. Inspect the page and provide a reviewed name and studentId.';
        else if (known.has(page.studentId) && known.get(page.studentId) !== page.name) page.reason = 'Conflicting names for the same student number; inspect the source.';
    }
    // Reviewed pages must also agree with one another, including pages with no text.
    const owners = new Map();
    for (const page of pages) {
        if (page.reason) continue;
        if (owners.has(page.studentId) && owners.get(page.studentId) !== page.name) page.reason = 'Conflicting reviewed names for one student number.';
        owners.set(page.studentId, page.name);
    }
    // Certificates have only a full-name label. Require verified name parts instead
    // of guessing where a compound surname begins; reuse them on continuation pages.
    const nameParts = new Map();
    for (const page of pages) {
        if (page.reason || !page.firstNames || !page.surname) continue;
        const previous = nameParts.get(page.studentId);
        const key = `${page.firstNames}|${page.surname}`.toLowerCase().replace(/\s+/g, ' ');
        if (previous && previous.key !== key) page.reason = 'Conflicting reviewed given names or surnames for one student number.';
        else nameParts.set(page.studentId, { firstNames: page.firstNames, surname: page.surname, key });
    }
    for (const page of pages) {
        if (page.reason) continue;
        const parts = nameParts.get(page.studentId);
        if (parts) {
            page.firstNames = parts.firstNames;
            page.surname = parts.surname;
        }
        try { proofFilename(page); }
        catch { page.reason = 'Verify the separate firstNames and surname fields in the review mapping; the full name alone cannot reliably identify a compound surname.'; }
    }
    return pages;
}

export async function splitCombinedPdf(bytes, mapping = []) {
    const pages = await inspectCombinedPdf(bytes, mapping);
    const review = pages.filter(page => page.reason);
    if (review.length) return { data: null, review, count: 0 };
    const groups = new Map();
    for (const page of pages) {
        if (!groups.has(page.studentId)) groups.set(page.studentId, { name: page.name, firstNames: page.firstNames, surname: page.surname, studentId: page.studentId, pages: [] });
        groups.get(page.studentId).pages.push(page.page - 1);
    }
    const students = [...groups.values()];
    const filenames = proofFilenames(students);
    const source = await PDFDocument.load(bytes);
    const zip = new JSZip();
    for (let index = 0; index < students.length; index++) {
        const output = await PDFDocument.create();
        // Copy original page resources, graphics, text, and dimensions without re-rendering.
        const copied = await output.copyPages(source, students[index].pages);
        copied.forEach(page => output.addPage(page));
        zip.file(filenames[index], await output.save());
    }
    return { data: await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' }), review: [], count: students.length };
}

async function main() {
    const [input, ...args] = process.argv.slice(2);
    if (!input || input.startsWith('--')) throw new Error('Usage: node scripts/split-registration-pdf.mjs input.pdf [--out proof-output] [--mapping reviewed-pages.json]');
    for (let index = 0; index < args.length; index += 2) {
        if (!['--out', '--mapping'].includes(args[index]) || !args[index + 1]) throw new Error('Expected --out directory or --mapping file.');
    }
    const outputDirectory = resolve(args.includes('--out') ? args[args.indexOf('--out') + 1] : 'proof-output');
    const mapping = args.includes('--mapping') ? JSON.parse(await readFile(args[args.indexOf('--mapping') + 1], 'utf8')) : [];
    if (!Array.isArray(mapping) || new Set(mapping.map(page => page.page)).size !== mapping.length) throw new Error('Mapping must be an array with one entry per page.');
    const result = await splitCombinedPdf(await readFile(input), mapping);
    await mkdir(outputDirectory, { recursive: true });
    if (result.review.length) {
        const reviewPath = join(outputDirectory, 'pages-needing-review.json');
        await writeFile(reviewPath, JSON.stringify(result.review.map(page => ({ ...page, reviewed: false })), null, 2), { flag: 'wx' });
        console.error(`No ZIP created. Review ${result.review.length} uncertain page(s) in ${reviewPath}, then rerun with --mapping. Multiple-student pages cannot be assigned as a whole.`);
        process.exitCode = 2;
        return;
    }
    const outputPath = join(outputDirectory, 'Separated_Proofs_of_Registration.zip');
    await writeFile(outputPath, result.data, { flag: 'wx' });
    console.log(`Saved ${result.count} individual PDFs in ${outputPath}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
    main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
