import { Injectable } from '@angular/core';
import { ProfileImage } from 'src/app/domain/models/profile-image/profile-image';
import { BaseRepository } from 'src/app/gateways/repositories/base-repository';
import { ViewProfileImage } from 'src/app/site/pages/meetings/view-models/view-profile-image';
import { Fieldsets } from 'src/app/site/services/model-request-builder';

import { RepositoryServiceCollectorService } from '../repository-service-collector.service';

@Injectable({
    providedIn: `root`
})
export class ProfileImageRepositoryService extends BaseRepository<ViewProfileImage, ProfileImage> {
    public constructor(repositoryServiceCollector: RepositoryServiceCollectorService) {
        super(repositoryServiceCollector, ProfileImage);
    }

    public getVerboseName = (plural?: boolean): string => (plural ? `Profile images` : `Profile image`);
    public getTitle = (viewModel: ViewProfileImage): string => `Profile image ${viewModel.id}`;

    public override getFieldsets(): Fieldsets<ProfileImage> {
        const baseFields: (keyof ProfileImage)[] = [];
        const requiredFields: (keyof ProfileImage)[] = baseFields.concat([
            `user_id`,
            `mediafile_id`,
            `create_timestamp`
        ]);
        return {
            ...super.getFieldsets(),
            required: requiredFields
        };
    }
}
