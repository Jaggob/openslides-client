import { Component, OnDestroy, OnInit } from '@angular/core';
import { UntypedFormBuilder, UntypedFormGroup } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { TranslateService } from '@ngx-translate/core';
import { Subscription, combineLatest } from 'rxjs';
import { filter, take } from 'rxjs/operators';
import { Id } from 'src/app/domain/definitions/key-types';
import { Permission } from 'src/app/domain/definitions/permission';
import { Assignment } from 'src/app/domain/models/assignments/assignment';
import { MeetingMediafileRepositoryService } from 'src/app/gateways/repositories/meeting-mediafile/meeting-mediafile-repository.service';
import { MediafileRepositoryService } from 'src/app/gateways/repositories/mediafiles/mediafile-repository.service';
import { BaseMeetingComponent } from 'src/app/site/pages/meetings/base/base-meeting.component';
import { ViewAssignment, ViewAssignmentCandidate } from 'src/app/site/pages/meetings/pages/assignments';
import { ViewMeetingMediafile } from 'src/app/site/pages/meetings/pages/mediafiles';
import { OperatorService } from 'src/app/site/services/operator.service';
import { SequentialNumberMappingService } from 'src/app/site/pages/meetings/services/sequential-number-mapping.service';
import { PromptService } from 'src/app/ui/modules/prompt-dialog';

import { AgendaItemControllerService } from '../../../../../agenda/services/agenda-item-controller.service';
import { AssignmentControllerService } from '../../../../services/assignment-controller.service';
import { AssignmentCandidatePdfService } from '../../../../services/assignment-candidate-pdf.service';
import { AssignmentCandidateControllerService } from '../../services/assignment-candidate-controller.service';

@Component({
    selector: `os-assignment-candidate-detail`,
    templateUrl: `./assignment-candidate-detail.component.html`,
    styleUrls: [`./assignment-candidate-detail.component.scss`],
    standalone: false
})
export class AssignmentCandidateDetailComponent extends BaseMeetingComponent implements OnInit, OnDestroy {
    public assignment: ViewAssignment | null = null;
    public candidate: ViewAssignmentCandidate | null = null;

    public previousCandidate: ViewAssignmentCandidate | null = null;
    public nextCandidate: ViewAssignmentCandidate | null = null;

    public isEditing = false;
    public form: UntypedFormGroup;
    public candidateApplicationsEnabled = true;
    public readonly saveApplicationAction = (): Promise<void> => this.saveApplication();

    private _assignmentId: Id | null = null;
    private _candidateId: Id | null = null;
    private _subs: Subscription[] = [];

    public constructor(
        protected override translate: TranslateService,
        private route: ActivatedRoute,
        private sequentialNumberMapping: SequentialNumberMappingService,
        private assignmentRepo: AssignmentControllerService,
        private agendaItemRepo: AgendaItemControllerService,
        private assignmentCandidateRepo: AssignmentCandidateControllerService,
        private candidatePdfService: AssignmentCandidatePdfService,
        private promptService: PromptService,
        private operator: OperatorService,
        private meetingMediafileRepo: MeetingMediafileRepositoryService,
        private mediafileRepo: MediafileRepositoryService,
        formBuilder: UntypedFormBuilder
    ) {
        super();
        this.form = formBuilder.group({
            application: [``],
            attachment_mediafile_ids: [[]]
        });
    }

    public ngOnInit(): void {
        this._subs.push(
            this.meetingSettingsService
                .get(`assignments_enable_candidate_applications`)
                .subscribe(value => (this.candidateApplicationsEnabled = !!value))
        );
        const parentParams$ = this.route.parent?.paramMap;
        const params$ = this.route.paramMap;
        const url$ = this.route.url;
        if (!parentParams$) {
            return;
        }
        this._subs.push(
            combineLatest([parentParams$, params$, url$])
                .pipe(filter(([parent, child]) => !!parent.get(`id`) && !!child.get(`candidateId`)))
                .subscribe(([parent, child, url]) => {
                    const assignmentSequential = Number(parent.get(`id`));
                    const candidateId = Number(child.get(`candidateId`));
                    this._candidateId = candidateId || null;
                    this.isEditing = url.some(segment => segment.path === `edit`);
                    if (assignmentSequential) {
                        this.loadAssignment(assignmentSequential);
                    }
                    if (this.assignment) {
                        this.updateCandidate();
                    }
                    if (this.isEditing && (!this.canEdit || !this.candidateApplicationsEnabled)) {
                        this.navigateToView();
                    }
                })
        );
    }

    public override ngOnDestroy(): void {
        this._subs.forEach(sub => sub.unsubscribe());
    }

    public get canEdit(): boolean {
        if (!this.candidate) {
            return false;
        }
        if (this.operator.hasPerms(Permission.assignmentCanManage)) {
            return true;
        }
        return (
            this.candidate.user_id === this.operator.operatorId &&
            this.operator.hasPerms(Permission.assignmentCanNominateSelf)
        );
    }

    public get sortedAttachments(): ViewMeetingMediafile[] {
        if (!this.candidate?.attachment_meeting_mediafiles) {
            return [];
        }
        return this.candidate.attachment_meeting_mediafiles
            .slice()
            .sort((a, b) => a.getTitle().localeCompare(b.getTitle()));
    }

    public get showNavigateButtons(): boolean {
        return !this.isEditing && (!!this.previousCandidate || !!this.nextCandidate);
    }

    public get assignmentBackUrl(): string {
        if (this.assignment && this.activeMeetingId) {
            return `/${this.activeMeetingId}/assignments/${this.assignment.sequential_number}`;
        }
        return `..`;
    }

    public getCandidateName(candidate: ViewAssignmentCandidate | null): string {
        return candidate?.user?.short_name || candidate?.user?.full_name || candidate?.getTitle() || ``;
    }

    public navigateToCandidate(candidate: ViewAssignmentCandidate | null): void {
        if (!candidate || !this.assignment) {
            return;
        }
        this.router.navigate([
            `/${this.activeMeetingId}/assignments/${this.assignment.sequential_number}/candidate/${candidate.id}`
        ]);
    }

    public async saveApplication(): Promise<void> {
        if (!this.candidate || !this.canEdit || !this.candidateApplicationsEnabled) {
            return;
        }
        await this.assignmentCandidateRepo.update(this.candidate, this.form.value);
        // Optimistically update the view to avoid a manual refresh.
        this.candidate.application = this.form.value.application || ``;
        const mediafileIds = (this.form.value.attachment_mediafile_ids || []) as Id[];
        this.updateAttachmentsFromMediafiles(mediafileIds);
        this.form.markAsPristine();
        this.navigateToView();
    }

    public onDownloadPdf(): void {
        if (this.candidate) {
            this.candidatePdfService.exportSingleCandidate(this.candidate, this.assignment || undefined);
        }
    }


    public addToAgenda(): void {
        if (this.candidate) {
            this.agendaItemRepo.addToAgenda({}, this.candidate).resolve();
        }
    }

    public removeFromAgenda(): void {
        if (this.candidate?.agenda_item_id) {
            this.agendaItemRepo.removeFromAgenda(this.candidate.agenda_item_id);
        }
    }

    public goToHistory(): void {
        if (this.assignment) {
            this.router.navigate([this.activeMeetingId!, `history`], { queryParams: { fqid: this.assignment.fqid } });
        }
    }

    public async deleteCandidate(): Promise<void> {
        if (!this.candidate || !this.assignment) {
            return;
        }
        const title = this.translate.instant(`Are you sure you want to remove this candidate?`);
        const content = this.getCandidateName(this.candidate);
        if (await this.promptService.open(title, content)) {
            await this.assignmentCandidateRepo.delete(this.candidate);
            this.router.navigate([`/${this.activeMeetingId}/assignments/${this.assignment.sequential_number}`]);
        }
    }

    private async loadAssignment(sequentialNumber: Id): Promise<void> {
        if (!this.activeMeetingId) {
            return;
        }
        const id = await this.sequentialNumberMapping.getIdBySequentialNumber({
            collection: Assignment.COLLECTION,
            meetingId: this.activeMeetingId,
            sequentialNumber
        });
        if (!id || this._assignmentId === id) {
            return;
        }
        this._assignmentId = id;
        this._subs.push(
            this.assignmentRepo.getViewModelObservable(id).subscribe(assignment => {
                if (assignment) {
                    this.assignment = assignment;
                    this.updateCandidate();
                }
            })
        );
    }

    private updateCandidate(): void {
        if (!this.assignment || !this._candidateId) {
            return;
        }
        const candidates = this.assignment.candidates || [];
        const index = candidates.findIndex(candidate => candidate.id === this._candidateId);
        this.candidate = index >= 0 ? candidates[index] : null;
        this.previousCandidate = index > 0 ? candidates[index - 1] : null;
        this.nextCandidate = index >= 0 && index < candidates.length - 1 ? candidates[index + 1] : null;
        if (this.candidate) {
            this.form.patchValue({
                application: this.candidate.application || ``,
                attachment_mediafile_ids:
                    this.candidate.attachment_meeting_mediafiles?.map(file => file.mediafile_id) || []
            });
            this.form.markAsPristine();
            if (this.isEditing && !this.canEdit) {
                this.navigateToView();
            }
        }
    }

    public navigateToView(): void {
        if (!this.assignment || !this.candidate) {
            return;
        }
        this.router.navigate(
            [`/${this.activeMeetingId}/assignments/${this.assignment.sequential_number}/candidate/${this.candidate.id}`],
            { replaceUrl: true }
        );
    }

    private mapToMeetingMediafiles(
        mediafileIds: Id[]
    ): { meetingMediafiles: ViewMeetingMediafile[]; meetingMediafileIds: Id[] } {
        if (!this.activeMeetingId || !mediafileIds?.length) {
            return { meetingMediafiles: [], meetingMediafileIds: [] };
        }
        const meetingMediafiles: ViewMeetingMediafile[] = [];
        const meetingMediafileIds: Id[] = [];
        for (const mediafileId of mediafileIds) {
            const meetingMediafileId = this.meetingMediafileRepo.getIdByMediafile(this.activeMeetingId!, mediafileId);
            if (meetingMediafileId) {
                const meetingMediafile = this.meetingMediafileRepo.getViewModel(meetingMediafileId);
                if (meetingMediafile) {
                    meetingMediafiles.push(meetingMediafile);
                    meetingMediafileIds.push(meetingMediafile.id);
                    continue;
                }
            }
            const mediafile = this.mediafileRepo.getViewModel(mediafileId);
            if (mediafile) {
                meetingMediafiles.push(this.createFallbackMeetingMediafile(mediafileId));
            }
        }
        return { meetingMediafiles, meetingMediafileIds };
    }

    private createFallbackMeetingMediafile(mediafileId: Id): ViewMeetingMediafile {
        const mediafile = this.mediafileRepo.getViewModel(mediafileId);
        const url = mediafile?.is_directory ? `/mediafiles/${mediafileId}` : `/system/media/get/${mediafileId}`;
        return {
            id: -mediafileId,
            meeting_id: this.activeMeetingId!,
            mediafile_id: mediafileId,
            mediafile,
            getTitle: () => mediafile?.title || ``,
            getIcon: () => mediafile?.getIcon() || `insert_drive_file`,
            url
        } as ViewMeetingMediafile;
    }

    private updateAttachmentsFromMediafiles(mediafileIds: Id[]): void {
        if (!this.candidate) {
            return;
        }
        const { meetingMediafiles, meetingMediafileIds } = this.mapToMeetingMediafiles(mediafileIds);
        this.candidate.attachment_meeting_mediafiles = meetingMediafiles;
        this.candidate.attachment_meeting_mediafile_ids = meetingMediafileIds;
        const missingMediafileIds = mediafileIds.filter(id => !this.mediafileRepo.getViewModel(id));
        for (const missingId of missingMediafileIds) {
            this._subs.push(
                this.mediafileRepo
                    .getViewModelObservable(missingId)
                    .pipe(
                        filter(mediafile => !!mediafile),
                        take(1)
                    )
                    .subscribe(() => this.updateAttachmentsFromMediafiles(mediafileIds))
            );
        }
    }

}
