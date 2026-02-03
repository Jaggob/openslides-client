import { Injectable } from '@angular/core';
import { TranslateService } from '@ngx-translate/core';
import { Content, ContentText } from 'pdfmake/interfaces';
import { HtmlToPdfService } from 'src/app/gateways/export/html-to-pdf.service';
import { MeetingPdfExportService } from 'src/app/site/pages/meetings/services/export';

import { ViewAssignmentCandidate } from '../view-models';
import { AssignmentExportServiceModule } from './assignment-export-service.module';
import { ViewAssignment } from '../view-models/view-assignment';

/**
 * Creates a PDF document from a single assignment candidate application
 */
@Injectable({ providedIn: AssignmentExportServiceModule })
export class AssignmentCandidatePdfService {
    public constructor(
        private translate: TranslateService,
        private htmlToPdfService: HtmlToPdfService,
        private pdfDocumentService: MeetingPdfExportService
    ) {}

    /**
     * Generates a pdf out of a given assignment candidate application and saves it as file
     */
    public exportSingleCandidate(candidate: ViewAssignmentCandidate, assignment?: ViewAssignment): void {
        const doc = this.candidateToDocDef(candidate, assignment);
        const candidateName = this.getCandidateName(candidate);
        const filename = `${this.translate.instant(`Application`)}_${candidateName}`;
        const metadata = {
            title: filename
        };
        this.pdfDocumentService.download({ docDefinition: doc, filename, metadata });
    }

    private candidateToDocDef(candidate: ViewAssignmentCandidate, assignment?: ViewAssignment): Content[] {
        const title = this.createTitle(candidate);
        const assignmentInfo = assignment ? this.createAssignmentInfo(assignment) : [];
        const application = this.createApplication(candidate);
        const attachments = this.createAttachments(candidate);

        return [title, assignmentInfo, application, attachments];
    }

    private createTitle(candidate: ViewAssignmentCandidate): ContentText {
        return {
            text: this.getCandidateName(candidate),
            style: `title`
        };
    }

    private createAssignmentInfo(assignment: ViewAssignment): ContentText {
        return {
            text: assignment.title,
            style: `textItem`,
            margin: [0, 0, 0, 10]
        };
    }

    private createApplication(candidate: ViewAssignmentCandidate): Content {
        if (candidate.application) {
            return this.htmlToPdfService.addPlainText(candidate.application);
        }
        return {
            text: this.translate.instant(`No application submitted`),
            style: `textItem`,
            italics: true,
            margin: [0, 0, 0, 10]
        };
    }

    private createAttachments(candidate: ViewAssignmentCandidate): Content {
        const files = candidate.attachment_meeting_mediafiles || [];
        if (!files.length) {
            return [];
        }
        return [
            {
                text: this.translate.instant(`Attachments`),
                bold: true,
                style: `textItem`,
                margin: [0, 10, 0, 4]
            },
            {
                ul: files.map(file => file.getTitle())
            }
        ];
    }

    private getCandidateName(candidate: ViewAssignmentCandidate): string {
        return candidate.user?.short_name || candidate.user?.full_name || candidate.getTitle();
    }
}
