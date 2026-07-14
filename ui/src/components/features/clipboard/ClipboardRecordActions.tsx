import { Star, Trash2 } from "lucide-react";
import { Button, Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "../../ui";

type ClipboardRecordActionsProps = {
  favorite: boolean;
  onDelete: () => void;
  onToggleFavorite: () => void;
};

export function ClipboardRecordActions({
  favorite,
  onDelete,
  onToggleFavorite,
}: ClipboardRecordActionsProps) {
  return (
    <TooltipProvider delayDuration={250}>
      <div className="clipboard-record-actions">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              aria-label={favorite ? "取消收藏" : "收藏"}
              className={favorite ? "clipboard-record-action is-favorite" : "clipboard-record-action"}
              onClick={onToggleFavorite}
              size="icon"
              variant="ghost"
            >
              <Star fill={favorite ? "currentColor" : "none"} />
            </Button>
          </TooltipTrigger>
          <TooltipContent>{favorite ? "取消收藏" : "收藏"}</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              aria-label="删除"
              className="clipboard-record-action is-delete"
              onClick={onDelete}
              size="icon"
              variant="ghost"
            >
              <Trash2 />
            </Button>
          </TooltipTrigger>
          <TooltipContent>删除</TooltipContent>
        </Tooltip>
      </div>
    </TooltipProvider>
  );
}
