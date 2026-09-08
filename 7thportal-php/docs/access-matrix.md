# 7thPortal access matrix

What each role can do across every part of the portal. This is generated from the permission checks in the application code, so it reflects what the portal actually enforces.

A person's role is set by an administrator. A leader who also has a child in the group can switch to a parent view that shows only their own children; the two views' permissions are never merged.

> This table is derived from the permission checks in `src/lib/*` and `src/routes/*` (the `*Can*` and `is*Role` functions). When one of those rules changes, update this file to match.

## Roles

- **Parent**: A parent or carer. Sees only their own children and the pages published to them.
- **Section Leader**: Runs a section. Full access to that section, including emergency contacts.
- **Assistant Leader**: Assistant leader or section volunteer. Helps run a section with slightly narrower access.
- **Group Leadership**: Group Leadership Team. Oversees the whole group and approves activities.
- **Quartermaster**: Looks after equipment: the catalogue, stock and approving kit bookings.
- **Trustee Viewer**: A trustee with read only oversight. Counts and totals, not personal detail.
- **Treasurer**: Runs finance. Gives second approval on higher value items and records payments.
- **Chair**: Chair of trustees. Senior approver for activities and finance.
- **Admin**: Portal Administrator. Full control, including settings, users and the mail server.

## Access levels

| Level | Meaning |
| --- | --- |
| Manage | Full control: create, edit, approve and configure. |
| Approve | Sign off what others submit. Never your own. |
| Raise | Create and submit your own. |
| Own | Limited to your own sections or records. |
| View | Read only. |
| Summary | Totals and counts only, no personal detail. |
| · | No access. |

## Access by area

### Access and identity

| Area | Parent | Section Leader | Assistant Leader | Group Leadership | Quartermaster | Trustee Viewer | Treasurer | Chair | Admin |
| --- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| Emergency contacts and sensitive member data<br><sub>Parents see only their own children.</sub> | Own | Manage | · | · | · | · | · | · | Manage |
| Section rosters and member lists<br><sub>Limited to the sections a leader leads in OSM.</sub> | · | Own | Own | Own | · | · | · | · | Manage |
| Search across people and records<br><sub>Results are filtered to what each person may see.</sub> | Own | View | View | View | View | View | View | View | View |

### Young people and safety

| Area | Parent | Section Leader | Assistant Leader | Group Leadership | Quartermaster | Trustee Viewer | Treasurer | Chair | Admin |
| --- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| Attendance registers<br><sub>Scoped to the leader’s own sections.</sub> | · | Own | Own | Own | · | · | · | · | Manage |
| Log an incident or near miss | · | Raise | Raise | Raise | · | · | · | · | Manage |
| View restricted incident records<br><sub>Plus the reporter or assignee. Standard records are also seen by section leaders.</sub> | · | · | · | View | · | · | · | · | View |

### Activities and events

| Area | Parent | Section Leader | Assistant Leader | Group Leadership | Quartermaster | Trustee Viewer | Treasurer | Chair | Admin |
| --- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| Activity approval: raise a request | · | Raise | Raise | Raise | · | · | · | · | Manage |
| Activity approval: approve and refer to District<br><sub>The submitter can never approve their own.</sub> | · | · | · | Approve | · | · | · | Approve | Approve |
| Events and camps<br><sub>Parents see published pages for their child’s section.</sub> | View | Manage | Manage | Manage | · | · | · | · | Manage |
| Calendar | View | Manage | Manage | Manage | View | View | View | View | Manage |
| Patrol Points<br><sub>Parents see the read only leaderboard.</sub> | View | Manage | Manage | Manage | · | · | · | · | Manage |

### Equipment and quartermaster

| Area | Parent | Section Leader | Assistant Leader | Group Leadership | Quartermaster | Trustee Viewer | Treasurer | Chair | Admin |
| --- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| Equipment register<br><sub>Quartermaster and Group Leadership manage the catalogue and stock.</sub> | · | View | View | Manage | Manage | View | View | View | Manage |
| Kit bookings: request<br><sub>Trustee Viewer and Chair see summary counts only.</sub> | · | Raise | Raise | Raise | Raise | Summary | Raise | Summary | Raise |
| Kit bookings: approve, substitute, hand out | · | · | · | Approve | Approve | · | · | · | Approve |
| Equipment disposal: approve | · | · | · | Approve | · | · | · | Approve | Approve |

### Forms

| Area | Parent | Section Leader | Assistant Leader | Group Leadership | Quartermaster | Trustee Viewer | Treasurer | Chair | Admin |
| --- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| Complete a form | · | Raise | Raise | Raise | · | · | Raise | Raise | Raise |
| Approve a form | · | · | · | Approve | · | · | · | Approve | Approve |
| Build templates and see all submissions | · | · | · | · | · | · | · | · | Manage |

### Finance

| Area | Parent | Section Leader | Assistant Leader | Group Leadership | Quartermaster | Trustee Viewer | Treasurer | Chair | Admin |
| --- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| Raise an expense claim | · | Raise | Raise | Raise | Raise | Raise | Raise | Raise | Raise |
| Approve claim items<br><sub>A leader approves only the items they are named the approver for.</sub> | · | Approve | Approve | Approve | Approve | Approve | Approve | Approve | Manage |
| Second approval on higher value items | · | · | · | · | · | · | Approve | Approve | Approve |
| Record payments | · | · | · | · | · | · | Manage | · | Manage |
| Accounts view (spend by account) | · | · | · | · | · | View | View | View | View |
| Exports (download CSV) | · | · | · | · | · | · | Manage | · | Manage |
| Trustee finance dashboard | · | · | · | · | · | View | View | View | View |

### Content and communication

| Area | Parent | Section Leader | Assistant Leader | Group Leadership | Quartermaster | Trustee Viewer | Treasurer | Chair | Admin |
| --- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| Photo gallery<br><sub>Leaders manage their own albums. Parents see albums they are eligible for.</sub> | View | Own | Own | Own | Own | Own | Own | Own | Manage |
| Document library<br><sub>Any leader can add documents; everyone with leader access reads and acknowledges them.</sub> | · | Manage | Manage | Manage | Manage | Manage | Manage | Manage | Manage |
| Notices<br><sub>Shown to each audience. Administrators create and publish them.</sub> | View | View | View | View | View | View | View | View | Manage |

### Administration

| Area | Parent | Section Leader | Assistant Leader | Group Leadership | Quartermaster | Trustee Viewer | Treasurer | Chair | Admin |
| --- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| Admin area: users, settings, feature switches, mail server, demo data, finance setup | · | · | · | · | · | · | · | · | Manage |

## Notes the grid cannot fully carry

- **Finance approval is per account.** A leader can approve only the specific claim items for which they were named as the approver; there is no blanket "approver" role.
- **Section access follows OSM.** Access to sections, rosters and attendance is limited to the sections a leader actually leads in OSM. Trustee Viewer has no member access; an administrator sees all.
- **Sensitive member data is tightly held.** Emergency contacts and similar detail are visible only to Section Leaders and Administrators.
- **Restricted incident records** are visible only to Group Leadership, an Administrator, and the person who reported or was assigned the record. Standard records are also visible to the section leaders involved.
- **Feature switches apply first.** Every optional module can be turned off by an administrator; when it is off, no role has access regardless of the table above.
