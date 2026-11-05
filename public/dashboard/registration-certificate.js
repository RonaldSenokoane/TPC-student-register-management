export function drawProofCertificate(pdf, { student, logo, name, dateOfBirth }) {
	const pageWidth = pdf.internal.pageSize.getWidth();
	const pageHeight = pdf.internal.pageSize.getHeight();
	const margin = 26;
	const currentDate = new Date();
	const academicYear = student.academicYear || currentDate.getFullYear();
	const issueDate = new Intl.DateTimeFormat('en-GB', {
		day: '2-digit',
		month: '2-digit',
		year: 'numeric'
	}).format(currentDate);
	const textWidth = pageWidth - margin * 2;

	pdf.setTextColor(0, 0, 0);
	pdf.setFont('helvetica', 'bold');
	pdf.addImage(logo, 'PNG', margin + 2, 25, 24, 29);
	pdf.setFontSize(17);
	pdf.text('TPC Menlyn', pageWidth * 0.68, 31, { align: 'center' });
	pdf.setFont('helvetica', 'italic');
	pdf.setFontSize(12);
	pdf.text('Become your Best', pageWidth * 0.68, 40, { align: 'center' });

	let y = 69;
	const drawParagraph = (text, options = {}) => {
		const fontSize = options.fontSize || 10;
		const lineHeight = options.lineHeight || 5.3;
		const bold = options.bold || false;
		pdf.setFont('helvetica', bold ? 'bold' : 'normal');
		pdf.setFontSize(fontSize);
		const lines = pdf.splitTextToSize(text, textWidth);
		pdf.text(lines, margin, y);
		y += lines.length * lineHeight + (options.after || 0);
	};

	drawParagraph('PROOF OF REGISTRATION', { bold: true, fontSize: 11, after: 7 });
	drawParagraph(`This is to certify that the following student is currently registered at TPC Menlyn for the ${academicYear} academic year.`, { after: 5 });
	drawParagraph('STUDENT DETAILS', { bold: true, fontSize: 10, after: 3 });
	drawParagraph(`Full Name: ${name}`, { after: 3.5 });
	drawParagraph(`Student Number:${student.studentId || 'Not provided'}`, { after: 3.5 });
	drawParagraph(`ID/Passport Number: ${student.idNumber || 'Not provided'}`, { after: 3.5 });
	drawParagraph(`Date of Birth: ${dateOfBirth}`, { after: 5 });
	drawParagraph('PROGRAMME DETAILS', { bold: true, fontSize: 10, after: 3 });
	drawParagraph(`Programme Name: ${student.course || 'Not provided'}`, { after: 3.5 });
	drawParagraph(`Field of Study: ${student.fieldOfStudy || 'Not provided'}`, { after: 7 });
	drawParagraph('This certificate serves as official confirmation that the student named above is duly registered and actively enrolled in the stated program.', { after: 2 });
	drawParagraph('Should you require any further information, please do not hesitate to contact our administration office.', { after: 5 });
	drawParagraph('Sincerely,', { after: 9 });

	if (y + 40 > pageHeight - margin) {
		throw new Error(`Details for ${name} (${student.studentId || student.id}) exceed the space available on the one-page certificate. Shorten the student or programme details and try again.`);
	}
	pdf.setLineWidth(0.35);
	pdf.line(margin, y + 5, margin + 47, y + 5);
	y += 11;
	drawParagraph('Conrad Janse van Rensburg', { bold: true, fontSize: 10, after: 1 });
	drawParagraph('CEO', { after: 2 });
	drawParagraph(`Date: ${issueDate}`, { after: 5 });
	drawParagraph('Contact Information:', { bold: true, after: 2 });
	drawParagraph('13 Umgazi Street, Landmark Building, Floor 2, Menlopark, Pretoria, 0081', { fontSize: 8.5, lineHeight: 4.5, after: 1 });
	drawParagraph('Phone: 060 509 6027', { fontSize: 8.5, lineHeight: 4.5, after: 1 });
	drawParagraph('Email: conrad@natedstudies.co.za', { fontSize: 8.5, lineHeight: 4.5 });
}
