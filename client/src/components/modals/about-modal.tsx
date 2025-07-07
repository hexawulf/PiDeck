import { Info } from "lucide-react";
import { Dialog, DialogTrigger, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";

export default function AboutModal() {
  return (
    <Dialog>
      <Tooltip>
        <TooltipTrigger asChild>
          <DialogTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              className="p-2 bg-transparent hover:bg-pi-card-hover border-pi-border"
              aria-label="About PiDeck"
            >
              <Info className="w-5 h-5" />
            </Button>
          </DialogTrigger>
        </TooltipTrigger>
        <TooltipContent>
          <p>About PiDeck</p>
        </TooltipContent>
      </Tooltip>
      <DialogContent className="p-6 sm:rounded-xl">
        <DialogHeader>
          <DialogTitle>About PiDeck</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 text-sm">
          <div>
            <h2 className="font-bold mb-1">Tech Stack</h2>
            <ul className="list-disc list-inside space-y-1">
              <li>Backend: Node.js, Express.js, TypeScript</li>
              <li>Shell Integration: child_process</li>
              <li>Frontend: React 18, Vite, TypeScript</li>
              <li>Styling: TailwindCSS, Shadcn/ui</li>
              <li>State Management: TanStack Query</li>
              <li>Routing: Wouter</li>
              <li>Database: PostgreSQL + Drizzle ORM</li>
              <li>Auth: Session-based authentication</li>
            </ul>
          </div>
          <div>
            <h2 className="font-bold mb-1">Contact</h2>
            <p>Author: 0xWulf</p>
            <p>
              Email: <a href="mailto:dev@0xwulf.dev" className="underline">dev@0xwulf.dev</a>
            </p>
          </div>
          <div>
            <h2 className="font-bold mb-1">GitHub Repo</h2>
            <a
              href="https://github.com/hexawulf/PiDeck"
              className="underline break-all"
              target="_blank"
              rel="noopener noreferrer"
            >
              https://github.com/hexawulf/PiDeck
            </a>
          </div>
          <div>
            <p>Version: v1.0.0</p>
            <p>Release Date: June 2025</p>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
