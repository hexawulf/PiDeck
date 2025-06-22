# PiDeck AGENT Instructions

## Testing
- Run `npm run check` after making any modifications.

## Mount Info Widget

Implement a new widget showing mount information alongside filesystem usage.

1. **Backend Route**
   - Create `server/routes/mounts.ts`.
   - Use Express and `child_process.exec` to run `mount | grep -v snap`.
   - Parse lines with regex `^(.+?) on (.+?) type (.+?) \((.+?)\)$`.
   - Return an array of `{ device, mountpoint, fstype, options }`.
   - Import this route in `server/index.ts` and register it with `app.use(mountsRoute)`.

2. **Frontend Component**
   - Add `components/widgets/MountInfoBox.tsx`.
   - Fetch `/api/metrics/mounts` using TanStack Query, refetching every 15 seconds.
   - Display a table with columns **Mount**, **Type**, **Flags**, and **Device**.
   - Style the container with Tailwind: `rounded-2xl border p-4 shadow bg-[#0f172a] text-white w-full max-w-2xl ml-6`.

3. **Placement**
   - In `client/src/components/system-overview.tsx`, show `MountInfoBox` next to `FilesystemUsageBox`.
   - Wrap them in:
     ```tsx
     <div className="flex flex-wrap gap-6 mt-6">
       <FilesystemUsageBox />
       <MountInfoBox />
     </div>
     ```
