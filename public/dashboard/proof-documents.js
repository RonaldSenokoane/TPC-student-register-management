// Shared by browser downloads and the offline PDF separation utility.
function safeFilenamePart(value) {
    return String(value || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-zA-Z0-9_-]+/g, '_').replace(/^[_-]+|[_-]+$/g, '').slice(0, 100) || 'Unknown';
}

export function proofFilename(student, used = new Set()) {
    const surname = String(student.surname || '').trim().replace(/\s+/g, ' ');
    const givenNames = String(student.firstNames ?? student.name ?? '').trim();
    if (!surname || !givenNames || !/[a-z]/i.test(surname.normalize('NFKD'))) {
        throw new Error('Correct the student record: separate given names and surname are required for the PDF filename. A surname cannot be guessed from a full name.');
    }
    const capitalized = surname.replace(/[\p{L}\p{M}]+/gu, word =>
        word === word.toUpperCase() || word === word.toLowerCase()
            ? word[0].toUpperCase() + word.slice(1).toLowerCase() : word);
    // Hyphenated given names contribute one initial per part, in their original order.
    const initials = givenNames.normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
        .split(/[\s\u002d\u2010-\u2015]+/).filter(Boolean)
        .map(name => name.match(/[a-z]/i)?.[0]?.toUpperCase()).filter(Boolean);
    if (!initials.length) throw new Error('Correct the student given names before downloading their proof.');
    const base = `Proof_of_Registration_${safeFilenamePart(capitalized)}_${initials.join('_')}`;
    let candidate = base;
    if (used.has(candidate.toLowerCase()) && student.studentId) candidate += `_${safeFilenamePart(student.studentId)}`;
    const collisionBase = candidate;
    let suffix = 2;
    while (used.has(candidate.toLowerCase())) candidate = `${collisionBase}_${suffix++}`;
    used.add(candidate.toLowerCase());
    return `${candidate}.pdf`;
}

export function proofFilenames(students) {
    const used = new Set();
    return students.map(student => proofFilename(student, used));
}

export async function createProofArchive({ students, createPdf, Zip, onProgress = () => {} }) {
    if (!students.length) throw new Error('Select at least one student.');
    if (!Zip) throw new Error('ZIP generation is unavailable. Reload the page and try again.');
    const zip = new Zip();
    const used = new Set();
    const failures = [];
    let generated = 0;
    for (let index = 0; index < students.length; index++) {
        const student = students[index];
        try {
            const filename = proofFilename(student, used);
            // A fresh document must be returned for every student, never a shared PDF.
            const pdf = await createPdf(student);
            zip.file(filename, pdf.output('arraybuffer'));
            generated++;
        } catch (error) {
            failures.push({ student, message: error.message || 'PDF generation failed.' });
        }
        onProgress({ completed: index + 1, total: students.length, generated });
        // Allow progress to paint and the UI to respond between students.
        await new Promise(resolve => setTimeout(resolve, 0));
    }
    if (!generated) return { data: null, generated, failures };
    if (failures.length) zip.file('GENERATION_FAILURES.txt', failures.map(({ student, message }) =>
        `${[student.name, student.surname].filter(Boolean).join(' ')} (${student.studentId || student.id}): ${message}`
    ).join('\n'));
    const data = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
    return { data, generated, failures };
}
