# Hockey Planner

Plan hockey drills with an interactive rink and a local drill library.

Flask serves each screen through a Jinja template that extends `base.html`. The interactive rink, drag-and-drop, PDF exports, and fullscreen viewer run in JavaScript. Public share links and PDF QR codes use the `/share/` routes.

## Run the application

From the project root, run these commands.

```sh
uv sync
uv run hockeyplanner
```

Open [http://127.0.0.1:8000](http://127.0.0.1:8000) in a modern browser. Create an account with a username, email address, and password. Then choose **Free** on the plan selection page. **Full Access** is listed as coming soon. Free users can select **Upgrade plan** to compare plans. Power users and Full Access subscribers can manage their subscription in **Account Profile**. Switching to Free preserves saved content and applies the Free limits to new drills and plans. Sign in with either your username or your email address. If you have an older account without an email address, sign in with your username and add an email address when prompted. To change your email address later, click your name in the header. In PyCharm, you can also run `src/main.py` with the interpreter from the `.venv` folder.

Free accounts can save up to 10 drills and 3 practice plans. All other features are available. Editing a saved item does not use another slot, and deleting an item frees its slot. Copies of shared plans and their drills use slots in the recipient’s library.

## Create a drill

- Under **Layout**, choose **Full rink**, **Half rink**, or **Quarter rink**. The quarter-rink view crops both axes and extends past the horizontal midpoint enough to keep the entire goal and crease visible.
- Choose a marker and click the rink to place it. Click **Player** to see the teams. Blue is the default. Select **Team B** to place a red player. Use **Referee** to place an official. With **Select and Move**, Shift-click to select multiple players, then choose a color in **Player** to change them together. Use **Shot on goal** to mark where a shot begins.
- To mark the steps of a drill, choose **Step number**, select a number from 1 to 9, and click the rink.
- Choose a movement and a line shape. Drag from the starting point to the destination. When drawing a curve, move the pointer off the direct path to shape the bend. Choose **Freehand** to follow the pointer with a smoothed line.
- Use **Select and Move** to reposition or delete an item. When a goal is selected, use the rotation buttons to turn it in 15° increments. To move several items, drag from an empty area to draw a rectangle around them, then drag any selected item. Hold **Shift** to start the rectangle over an item. Undo and redo apply to changes on the rink.
- Enter a name and description. Click **Save Drill** to add the drill to the library or update the saved version.
- Use **PNG** or **PDF** to download the rink diagram with the drill name and description.

The application stores drills and plans in `data/hockeyplanner.sqlite3` on the machine running the server. Data is private to each account and remains available after you close the browser or restart the server. The first account created inherits the existing server library, including practice plans. Create that account on the computer before enabling network access. If you previously saved drills in your browser, open the updated app using the same address and browser profile to import those records into SQLite.

To access the same library from your phone, run `uv run hockeyplanner --host 0.0.0.0` on the computer and open `http://<computer-ip>:8000` on a phone connected to the same network. Sign in with the same account to access your data. The local server uses HTTP. On public networks, serve the application through an HTTPS proxy and start it with `--secure-cookies`.

## Browse drills and plans

Use **Drill Library** in the header to browse saved drills and open them in the editor. **Practice Plans** shows your plans and the drills in each one.

## Build a practice plan

Open **Practice Plans**, click **New Plan**, enter a name, and select one or more saved drills in the order they should be run. You can reopen drills from the plan, change the selection, or delete the plan. Plans and drills are stored in the same application database.

Use **View Fullscreen** to present drills in the saved order. Use **Previous** and **Next** or the left and right arrow keys to navigate. Click **Exit Presentation** to return to the list.

## Delete your account

Open **Account Profile**, choose **Delete my account**, and enter your current password. Account deletion permanently removes your profile, drills, practice plans, and shares and ends all active sessions. Copies already saved by other users remain in their accounts.

## Administer accounts

The first account created receives the `poweruser` role. In existing installations, the oldest account receives this role on upgrade. Sign in with that account and open **Administration** to change other users’ roles, disable or re-enable their access, or reset their passwords, or permanently delete an account and its owned drills and plans. Independent copies already saved by other users remain in those accounts. Disabling an account or resetting its password signs that user out of all active sessions. Drills and plans remain linked to their owner.

## Share plans

Click **Share** on a plan and enter the recipient’s username. The plan appears under **Shared with me** in the recipient’s account with read-only access. **Copy to My Account** saves an independent copy of the plan and each drill to the recipient’s library. The owner can revoke access to the original. The recipient can also remove it from **Shared with me**. Copies already saved remain available.

You can also create a share link from **Share**. Anyone with the link can preview the plan, present it in fullscreen, and print it without signing in. Recipients must sign in to accept the share or make an editable copy. Disabling the link prevents new recipients from accepting it. In the same dialog, use **Remove access** to revoke access for someone who has already accepted.

PDFs include the Hockey Planner logo and contact details. To add a QR code, enable the public link under **Share** on an owned practice plan. An existing standalone drill link is also included when exporting that saved drill. A shared plan PDF includes a QR code for the full plan and one for each drill. The drill code opens the fullscreen carousel at that drill, and the plan code starts at the first drill. A standalone drill code opens only that drill. These links work without an account. Plans shared with you include QR codes when their owner has enabled a public link. Export PDFs from a site address that recipients can reach.

To deactivate codes printed in plan PDFs, disable the public link in the practice plan's **Share** dialog.

## Configure account email

Registration and email changes require a six-digit code sent to the new address. The email contains a link to the confirmation page. Requests expire after 30 minutes. The app creates an account only after confirmation and keeps the existing address active until an email change is confirmed.

The sign-in page also lets users request a password reset at their registered email address. Reset links expire after 30 minutes and can be used once. Resetting a password signs out all existing sessions for the account.

If you do not already have a local `.env` file, copy the template.

```sh
cp -n .env-template .env
```

Fill in the values supplied by your SMTP provider, then start the application.

```sh
uv run --env-file .env hockeyplanner
```

Keep the `.env` file private. It is excluded from Git.

| Variable | Purpose |
| --- | --- |
| `HOCKEYPLANNER_PUBLIC_URL` | The browser-accessible URL used in confirmation and password reset links, such as `https://planner.example.com`. |
| `HOCKEYPLANNER_SMTP_HOST` | SMTP server hostname. |
| `HOCKEYPLANNER_SMTP_FROM` | Sender email address. |
| `HOCKEYPLANNER_SMTP_SECURITY` | `starttls` by default, or `ssl` for implicit TLS. |
| `HOCKEYPLANNER_SMTP_PORT` | Defaults to `587` for STARTTLS and `465` for implicit TLS. |
| `HOCKEYPLANNER_SMTP_USERNAME`, `HOCKEYPLANNER_SMTP_PASSWORD` | Credentials for an authenticated SMTP server. |

## Deploy with Podman

Build the image from the project root. Stop any other instance that uses port 8000 or the same SQLite database before starting the container.

```sh
podman build -t localhost/hockeyplanner:latest .
mkdir -p data
podman run --detach --name hockeyplanner --restart=unless-stopped \
  --userns=keep-id --user "$(id -u):$(id -g)" \
  --publish 127.0.0.1:8000:8000 \
  --env-file .env \
  --volume "$PWD/data:/app/data:Z" \
  localhost/hockeyplanner:latest
```

Open [http://127.0.0.1:8000](http://127.0.0.1:8000). The bind mount keeps your existing SQLite database in the project’s `data/` directory and preserves it when the container is replaced. The `.env` file provides environment variables at runtime and is excluded from the build context.

Check the container with `podman ps` and `podman logs hockeyplanner`. To serve on a trusted LAN, publish with `--publish 8000:8000` and set `HOCKEYPLANNER_PUBLIC_URL` in `.env` to the host address that recipients can reach.
