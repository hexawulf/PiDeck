# Screenshots

This directory contains screenshots of the PiDeck application for documentation purposes.

## Required Screenshots

To complete the documentation, please add the following screenshots:

1. **dashboard.png** - Main dashboard view showing system metrics
2. **logs-placeholder.png** - Log viewer interface
3. **apps-placeholder.png** - Docker and PM2 management interface
4. **cron-placeholder.png** - Cron job management interface
5. **login.png** - Login screen

## Screenshot Guidelines

- Use 1920x1080 resolution for consistency
- Capture full browser window with PiDeck interface
- Use dark theme (default)
- Include realistic data where possible
- Save as PNG format for best quality

## Capturing Screenshots

You can capture screenshots using:

```bash
# On Linux with gnome-screenshot
gnome-screenshot -w -f dashboard.png

# On macOS
cmd+shift+4 (then select window)

# In browser developer tools
Right-click → Inspect → Device toolbar → Capture screenshot
```

Once screenshots are added, update the paths in README.md:

```markdown
![PiDeck Dashboard](./docs/screenshots/dashboard.png)
```