import { Component } from '@angular/core';
import { Router } from '@angular/router';
import { Observable } from 'rxjs';
import {
    MeetingChangeNotification,
    MeetingChangeNotificationService
} from 'src/app/site/pages/meetings/services/meeting-change-notification.service';

@Component({
    selector: `os-meeting-notifications-button`,
    templateUrl: `./meeting-notifications-button.component.html`,
    styleUrls: [`./meeting-notifications-button.component.scss`],
    standalone: false
})
export class MeetingNotificationsButtonComponent {
    public readonly notificationsObservable: Observable<MeetingChangeNotification[]> =
        this.notificationService.notificationsObservable;
    public readonly unreadCountObservable: Observable<number> = this.notificationService.unreadCountObservable;
    public readonly unreadIdsObservable: Observable<string[]> = this.notificationService.unreadIdsObservable;
    public readonly readCountObservable: Observable<number> = this.notificationService.readCountObservable;
    public readonly hasActiveMeetingObservable: Observable<boolean> = this.notificationService.hasActiveMeetingObservable;

    public constructor(
        private notificationService: MeetingChangeNotificationService,
        private router: Router
    ) {}

    public clearNotifications(): void {
        this.notificationService.clearMeetingNotifications();
    }

    public clearReadNotifications(): void {
        this.notificationService.clearReadNotifications();
    }

    public markAsRead(notificationId: string): void {
        this.notificationService.markAsRead(notificationId);
    }

    public async openNotification(notification: MeetingChangeNotification): Promise<void> {
        this.markAsRead(notification.id);
        await this.router.navigate(notification.route, {
            queryParams: notification.queryParams
        });
    }

    public getTypeLabel(notification: MeetingChangeNotification): string {
        switch (notification.type) {
            case `motion`:
                return `New motion`;
            case `amendment`:
                return `New amendment`;
            case `candidate`:
                return `New candidate`;
            case `candidate_self`:
                return `You were added as candidate`;
            case `agenda_added`:
                return `Agenda item added`;
            case `agenda_updated`:
                return `Agenda item updated`;
            case `agenda_removed`:
                return `Agenda item removed`;
        }
        return `Notification`;
    }

    public getTypeIcon(notification: MeetingChangeNotification): string {
        switch (notification.type) {
            case `motion`:
            case `amendment`:
                return `assignment`;
            case `candidate`:
            case `candidate_self`:
                return `how_to_vote`;
            case `agenda_added`:
            case `agenda_updated`:
            case `agenda_removed`:
                return `today`;
        }
        return `notifications`;
    }

    public isUnread(notificationId: string, unreadIds: string[] | null): boolean {
        return !!unreadIds?.includes(notificationId);
    }

    public formatUnreadCount(count: number | null): string {
        const value = count ?? 0;
        return value > 99 ? `99+` : `${value}`;
    }

    public getUnreadCountClass(count: number | null): string {
        const value = count ?? 0;
        if (value > 99) {
            return `count-3`;
        }
        if (value > 9) {
            return `count-2`;
        }
        return `count-1`;
    }

    public getNotificationLine(notification: MeetingChangeNotification): string {
        if (
            (notification.type === `candidate` || notification.type === `candidate_self`) &&
            notification.subtitle
        ) {
            return `${notification.title} · ${notification.subtitle}`;
        }
        return notification.title;
    }
}
