# CareNest: Clinic Management System

Built by team KINGS.

- Dipansh Kumar (12611923)
- Rishv Rana (12611359)
- Ansh Bhardwaj (12612099)

## What is new in this version

- Two-step sign-in: password, then a 6-digit code sent by email (expires in 5 minutes, 5 tries, resend after 30 seconds)
- Patient sign-up with full name, age, gender, mobile number, email and password
- Patient portal: book and cancel own appointments, see own visit history
- Always-beating heart in the bottom-right corner
- Dark mode, menu icons, dashboard charts

## Run it (Windows Command Prompt)

1. Stop the old server (Ctrl + C) and **delete the file `carenest.db`** in this folder, because the database layout changed.
2. Install the new package (nodemailer):

```
npm install
```

3. Set up email for OTP codes. Use a Gmail account with 2-Step Verification on, and create an **App Password** (Google Account > Security > App passwords). Then run these, replacing the values:

```
set SMTP_USER=youraddress@gmail.com
set SMTP_PASS=your16characterapppassword
set ADMIN_EMAIL=youraddress@gmail.com
npm start
```

`ADMIN_EMAIL` becomes the admin login email, so the admin's codes reach your inbox. Use the same window for `npm start`, because `set` only lasts for that window.

4. Open http://localhost:3000

If SMTP is not set, the server prints every OTP code in its terminal, so you can still test.

## Demo accounts

| Role | Email | Password |
|---|---|---|
| Admin | ADMIN_EMAIL (or admin@carenest.com) | Admin@123 |
| Doctor | doctor@carenest.com | Doctor@123 |
| Receptionist | reception@carenest.com | Desk@123 |

The doctor and receptionist emails are not real inboxes, so their codes appear in the server terminal. Add staff with real emails from the Staff page to get codes by email.

## What each role can do

| Feature | Admin | Doctor | Receptionist | Patient |
|---|---|---|---|---|
| Dashboard | All data | Own appointments | All data | Own data |
| Add/edit patients | Yes | Yes | Yes | No |
| Delete patients | Yes | No | No | No |
| Book appointments | Yes | No | Yes | Own |
| Change appointment status | Yes | Own only | Yes | Cancel own booked |
| Record visits | Yes | Yes | No | No |
| Manage staff accounts | Yes | No | No | No |

## Before real use

Set a private secret: `set JWT_SECRET=your-long-random-text`
