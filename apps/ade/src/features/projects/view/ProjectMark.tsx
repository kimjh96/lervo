import { Mark } from "../../../ui/Mark";
import type { Repository } from "../../workspaces";
import { projectName } from "../model/decisions";
import { useProjectStore } from "../model/store";

/** A project's mark: its kept logo thumbnail, or its first letter until one is kept. */
export function ProjectMark(props: { project: Repository; size: "sm" | "md" }) {
  const marks = useProjectStore((store) => store.marks);
  const { project } = props;
  return (
    <Mark
      id={project.projectId}
      name={projectName(project)}
      src={project.mark ? (marks[project.mark.sha256] ?? null) : null}
      size={props.size}
    />
  );
}
