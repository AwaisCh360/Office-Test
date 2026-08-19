import React from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

const TerminalIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="4 17 10 11 4 5"/><line x1="12" x2="20" y1="19" y2="19"/></svg>
);

const BrainIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 5a3 3 0 1 0-5.997.125 4 4 0 0 0-2.526 5.77 4 4 0 0 0 .556 6.588A4 4 0 1 0 12 18Z"/><path d="M12 5a3 3 0 1 1 5.997.125 4 4 0 0 1 2.526 5.77 4 4 0 0 1-.556 6.588A4 4 0 1 1 12 18Z"/><path d="M15 13a4.5 4.5 0 0 1-3-4 4.5 4.5 0 0 1-3 4"/><path d="M17.599 6.5a3 3 0 0 0 .399-1.375"/></svg>
);

const NoteIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" x2="8" y1="13" y2="13"/><line x1="16" x2="8" y1="17" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>
);

const ToolIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg>
);

interface EventItem {
  id: string;
  type: string;
  agent_id: string;
  data?: any;
  content?: string;
}

interface AgentTerminalProps {
  events: EventItem[];
  agents: any[];
}

export default function AgentTerminal({ events, agents }: AgentTerminalProps) {
  if (!events || events.length === 0) {
    return <div className="text-ink-3 text-center py-12 font-sans">Booting agents and waiting for logs...</div>;
  }

  // Group events by agent to show agent headers properly if we want, 
  // but in a live timeline, they might interleave. 
  // For now, we'll just render them sequentially as they occurred.
  
  return (
    <div className="flex flex-col max-w-4xl mx-auto w-full">
      {events.map((ev, i) => {
        const isLast = i === events.length - 1;
        const agentName = agents?.find((a) => a.id === ev.agent_id)?.name || 'Agent';
        const isHuman = ev.type === 'human_message';
        
        // Skip unknown events that clog the terminal
        if (!isHuman && !ev.data?.tool_name && !ev.data?.message && !ev.content) {
          return null;
        }
        
        let type = "unknown";
        let title = "Unknown Event";
        let content = "";
        let colorClass = "text-ink-3";
        let borderClass = "border-line";
        let icon = <ToolIcon />;

        if (isHuman) {
          type = "human";
          title = "Terminal input";
          colorClass = "text-green-500";
          borderClass = "border-green-500/30";
          icon = <TerminalIcon />;
          content = ev.content || "";
        } else if (ev.data?.tool_name === "think") {
          type = "think";
          title = "Thinking";
          colorClass = "text-purple-500";
          borderClass = "border-purple-500/30";
          icon = <BrainIcon />;
          content = ev.data.args?.thought || "";
        } else if (ev.data?.tool_name === "note" || ev.data?.tool_name === "create_note") {
          type = "note";
          title = ev.data.args?.title ? `note (${ev.data.args.title})` : "note (findings)";
          colorClass = "text-yellow-500";
          borderClass = "border-yellow-500/30";
          icon = <NoteIcon />;
          content = ev.data.args?.findings || ev.data.args?.content || ev.data.args?.note || JSON.stringify(ev.data.args, null, 2);
        } else if (ev.data?.tool_name === "create_todo") {
          type = "todo";
          title = "created todos";
          colorClass = "text-blue-500";
          borderClass = "border-blue-500/30";
          icon = <ToolIcon />;
          try {
             let todos = typeof ev.data.args?.todos === 'string' ? JSON.parse(ev.data.args.todos) : ev.data.args?.todos;
             content = (todos || []).map((t: any) => `- **[${t.priority?.toUpperCase()}]** ${t.title}: ${t.description}`).join('\n');
          } catch(e) {
             content = JSON.stringify(ev.data.args, null, 2);
          }
        } else if (ev.data?.tool_name === "mark_todo_done") {
          type = "todo_done";
          title = "completed tasks";
          colorClass = "text-green-500";
          borderClass = "border-green-500/30";
          icon = <ToolIcon />;
          try {
             let ids = typeof ev.data.args?.todo_ids === 'string' ? JSON.parse(ev.data.args.todo_ids) : ev.data.args?.todo_ids;
             content = `Marked tasks as done: ${(ids || []).join(', ')}`;
          } catch(e) {
             content = JSON.stringify(ev.data.args, null, 2);
          }
        } else if (ev.data?.tool_name === "exec_command") {
          type = "exec";
          title = "Terminal input";
          colorClass = "text-green-500";
          borderClass = "border-green-500/30";
          icon = <TerminalIcon />;
          content = ev.data.args?.cmd || "";
        } else if (ev.data?.tool_name === "create_agent") {
          type = "agent";
          title = "spawned subagent";
          colorClass = "text-blue-500";
          borderClass = "border-blue-500/30";
          icon = <ToolIcon />;
          content = `**${ev.data.args?.name}**\n\nTask: ${ev.data.args?.task}\n\nSkills: ${(ev.data.args?.skills || []).join(', ')}`;
        } else if (ev.data?.tool_name === "wait_for_agents") {
          type = "wait";
          title = "waiting for agents";
          colorClass = "text-orange-500";
          borderClass = "border-orange-500/30";
          icon = <ToolIcon />;
          content = `Waiting for ${ev.data.args?.timeout_seconds} seconds.\n\nReason: ${ev.data.args?.reason}`;
        } else if (ev.data?.tool_name === "send_message_to_agent") {
          type = "message";
          title = "sent message to agent";
          colorClass = "text-blue-500";
          borderClass = "border-blue-500/30";
          icon = <ToolIcon />;
          const targetName = agents?.find((a) => a.id === ev.data.args?.target_agent_id)?.name || ev.data.args?.target_agent_id;
          content = `**To ${targetName}**: ${ev.data.args?.message}`;
        } else if (ev.data?.tool_name === "load_skill") {
          type = "tool";
          title = "loaded skills";
          colorClass = "text-blue-500";
          borderClass = "border-blue-500/30";
          icon = <ToolIcon />;
          try {
             let skills = typeof ev.data.args?.skills === 'string' ? JSON.parse(ev.data.args.skills) : ev.data.args?.skills;
             content = (skills || []).map((s: string) => `- \`${s}\``).join('\n');
          } catch(e) {
             content = `\`\`\`json\n${JSON.stringify(ev.data.args, null, 2)}\n\`\`\``;
          }
        } else if (ev.data?.tool_name) {
          type = "tool";
          title = `Tool: ${ev.data.tool_name}`;
          colorClass = "text-blue-500";
          borderClass = "border-blue-500/30";
          icon = <ToolIcon />;
          content = `\`\`\`json\n${JSON.stringify(ev.data.args, null, 2)}\n\`\`\``;
        } else if (ev.data?.message || ev.content) {
          type = "message";
          title = "Agent Message";
          colorClass = "text-ink";
          borderClass = "border-line";
          icon = <ToolIcon />;
          content = ev.data?.message || ev.content;
        }

        return (
          <div key={i} className="flex group">
            {/* Timeline Left Column */}
            <div className="flex flex-col items-center mr-5 w-8">
              <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 border ${borderClass} ${colorClass} bg-surface shadow-sm`}>
                {icon}
              </div>
              {!isLast && (
                <div className="w-px flex-1 bg-line/50 my-2 group-hover:bg-line transition-colors"></div>
              )}
            </div>
            
            {/* Timeline Content */}
            <div className="pb-8 flex-1 min-w-0">
              {/* Agent Header (Optional, could only show if it changed from previous, but let's show for clarity) */}
              <div className="flex items-center gap-2 mb-2">
                 <div className="w-1.5 h-1.5 rounded-full bg-blue-500"></div>
                 <span className="text-[13px] font-bold text-ink">{isHuman ? "You" : agentName}</span>
                 <span className="text-[11px] font-mono text-ink-3">{ev.agent_id?.substring(0, 8)}</span>
              </div>

              <h3 className={`text-[13.5px] font-bold mb-3 flex items-center ${colorClass}`}>
                {title}
              </h3>
              
              <div className="text-[13px] text-ink-2 leading-relaxed">
                {type === "exec" || type === "human" ? (
                  <div className="font-mono text-ink-2 whitespace-pre-wrap bg-surface p-3 rounded-md border border-line">
                    {content}
                  </div>
                ) : (
                  <div className={`prose prose-sm prose-invert max-w-none prose-p:my-2 prose-pre:bg-surface prose-pre:border prose-pre:border-line prose-th:bg-surface prose-th:border-line prose-th:p-2 prose-td:border-line prose-td:p-2 prose-table:border-line prose-table:border-collapse prose-table:w-full prose-table:my-4 prose-li:my-0.5 ${type === 'think' ? 'text-ink-3 italic prose-headings:text-ink-3 prose-strong:text-ink-3 prose-a:text-ink-3 prose-code:text-ink-3' : ''}`}>
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>
                      {content}
                    </ReactMarkdown>
                  </div>
                )}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
