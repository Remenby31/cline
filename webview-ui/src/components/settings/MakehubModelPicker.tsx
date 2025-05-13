// Remplaçons le composant VSCodeTextField avec notre propre implémentation
// qui garantit qu'aucun HTML ne puisse s'infiltrer dans le champ de texte

import { VSCodeLink } from "@vscode/webview-ui-toolkit/react"
import Fuse from "fuse.js"
import React, { KeyboardEvent, memo, useEffect, useMemo, useRef, useState } from "react"
import { useRemark } from "react-remark"
import { useMount } from "react-use"
import styled from "styled-components"
import { makehubDefaultModelId } from "@shared/api"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { vscode } from "@/utils/vscode"
import { highlight } from "../history/HistoryView"
import { ModelInfoView, normalizeApiConfiguration } from "./ApiOptions"
import { CODE_BLOCK_BG_COLOR } from "@/components/common/CodeBlock"

export const MAKEHUB_MODEL_PICKER_Z_INDEX = 1_000

// Star icon for favorites
const StarIcon = ({ isFavorite, onClick }: { isFavorite: boolean; onClick: (e: React.MouseEvent) => void }) => {
	return (
		<div
			onClick={onClick}
			style={{
				cursor: "pointer",
				color: isFavorite ? "var(--vscode-terminal-ansiBlue)" : "var(--vscode-descriptionForeground)",
				marginLeft: "8px",
				fontSize: "16px",
				display: "flex",
				alignItems: "center",
				justifyContent: "center",
				userSelect: "none",
				WebkitUserSelect: "none",
			}}>
			{isFavorite ? "★" : "☆"}
		</div>
	)
}

// Composant personnalisé pour la barre de recherche
const CustomSearchInput = styled.input`
  width: 100%;
  padding: 4px 8px;
  background-color: var(--vscode-input-background);
  color: var(--vscode-input-foreground);
  border: 1px solid var(--vscode-input-border, transparent);
  outline: none;
  font-family: var(--vscode-font-family);
  font-size: var(--vscode-font-size);
  line-height: 1.4;
  box-sizing: border-box;
  
  &:focus {
    border-color: var(--vscode-focusBorder);
  }
  
  &::placeholder {
    color: var(--vscode-input-placeholderForeground);
  }
`;

const ClearButton = styled.div`
  position: absolute;
  right: 8px;
  top: 50%;
  transform: translateY(-50%);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--vscode-descriptionForeground);
  
  &:hover {
    color: var(--vscode-foreground);
  }
`;

export interface MakehubModelPickerProps {
	isPopup?: boolean
}

const MakehubModelPicker: React.FC<MakehubModelPickerProps> = ({ isPopup }) => {
	const { apiConfiguration, setApiConfiguration, makehubModels } = useExtensionState()
	const initialDisplayName = 
		(apiConfiguration?.makehubModelId && makehubModels[apiConfiguration.makehubModelId]?.displayName) || 
		(makehubModels[makehubDefaultModelId]?.displayName || makehubDefaultModelId);
	
	// Deux états séparés: un pour la valeur affichée et un pour la recherche
	const [displayValue, setDisplayValue] = useState(initialDisplayName);
	const [searchQuery, setSearchQuery] = useState("");
	
	const [isDropdownVisible, setIsDropdownVisible] = useState(false);
	const [selectedIndex, setSelectedIndex] = useState(-1);
	const dropdownRef = useRef<HTMLDivElement>(null);
	const inputRef = useRef<HTMLInputElement>(null);
	const itemRefs = useRef<(HTMLDivElement | null)[]>([]);
	const [isDescriptionExpanded, setIsDescriptionExpanded] = useState(false);
	const dropdownListRef = useRef<HTMLDivElement>(null);
	
	const handleModelChange = (newModelId: string) => {
		// Update the model and its info
		setApiConfiguration({
			...apiConfiguration,
			...{
				makehubModelId: newModelId,
				makehubModelInfo: makehubModels[newModelId],
			},
		});
		
		// Utilise UNIQUEMENT le displayName propre, jamais de HTML
		const displayName = makehubModels[newModelId]?.displayName || newModelId;
		setDisplayValue(displayName);
		setSearchQuery(""); // Réinitialise la recherche
	}

	const { selectedModelId, selectedModelInfo } = useMemo(() => {
		return normalizeApiConfiguration(apiConfiguration);
	}, [apiConfiguration]);

	useMount(() => {
		vscode.postMessage({ type: "refreshMakehubModels" });
	});

	useEffect(() => {
		const handleClickOutside = (event: MouseEvent) => {
			if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
				setIsDropdownVisible(false);
				// Restaure la valeur d'affichage quand on ferme le dropdown sans sélection
				setDisplayValue(initialDisplayName);
				setSearchQuery("");
			}
		}

		document.addEventListener("mousedown", handleClickOutside);
		return () => {
			document.removeEventListener("mousedown", handleClickOutside);
		}
	}, [initialDisplayName]);

	const modelIds = useMemo(() => {
		return Object.keys(makehubModels || {}).sort((a, b) => a.localeCompare(b));
	}, [makehubModels]);

	// Mettre à jour les éléments de recherche pour inclure displayName
	const searchableItems = useMemo(() => {
		return modelIds.map((id) => {
			const displayName = makehubModels[id]?.displayName || id;
			return {
				id,
				html: displayName,
				displayName: displayName,
				searchTerms: `${displayName} ${id}`.toLowerCase() // Pour la recherche sur les deux champs
			}
		});
	}, [modelIds, makehubModels]);

	const fuse = useMemo(() => {
		return new Fuse(searchableItems, {
			keys: ["searchTerms", "html", "id"],
			threshold: 0.6,
			shouldSort: true,
			isCaseSensitive: false,
			ignoreLocation: false,
			includeMatches: true,
			minMatchCharLength: 1,
		});
	}, [searchableItems]);

	const modelSearchResults = useMemo(() => {
		const favoritedModelIds = apiConfiguration?.favoritedModelIds || [];

		// First, get all favorited models
		const favoritedModels = searchableItems.filter((item) => favoritedModelIds.includes(item.id));

		// Then get search results for non-favorited models
		let searchResults;
		if (searchQuery) {
			// Génère les résultats avec surlignage pour l'affichage dans la liste UNIQUEMENT
			const highlightedResults = highlight(fuse.search(searchQuery), "model-item-highlight")
				.filter((item) => !favoritedModelIds.includes(item.id));
			
			searchResults = highlightedResults;
		} else {
			searchResults = searchableItems.filter((item) => !favoritedModelIds.includes(item.id));
		}

		// Combine favorited models with search results
		return [...favoritedModels, ...searchResults];
	}, [searchableItems, searchQuery, fuse, apiConfiguration?.favoritedModelIds]);

	const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
		if (!isDropdownVisible) return;

		switch (event.key) {
			case "ArrowDown":
				event.preventDefault();
				setSelectedIndex((prev) => (prev < modelSearchResults.length - 1 ? prev + 1 : prev));
				break;
			case "ArrowUp":
				event.preventDefault();
				setSelectedIndex((prev) => (prev > 0 ? prev - 1 : prev));
				break;
			case "Enter":
				event.preventDefault();
				if (selectedIndex >= 0 && selectedIndex < modelSearchResults.length) {
					handleModelChange(modelSearchResults[selectedIndex].id);
					setIsDropdownVisible(false);
				}
				break;
			case "Escape":
				event.preventDefault();
				setIsDropdownVisible(false);
				setDisplayValue(initialDisplayName);
				setSearchQuery("");
				break;
		}
	};

	const hasInfo = useMemo(() => {
		try {
			const currentModelId = apiConfiguration?.makehubModelId || "";
			return modelIds.includes(currentModelId);
		} catch {
			return false;
		}
	}, [modelIds, apiConfiguration?.makehubModelId]);

	useEffect(() => {
		setSelectedIndex(-1);
		if (dropdownListRef.current) {
			dropdownListRef.current.scrollTop = 0;
		}
	}, [searchQuery]);

	useEffect(() => {
		if (selectedIndex >= 0 && itemRefs.current[selectedIndex]) {
			itemRefs.current[selectedIndex]?.scrollIntoView({
				block: "nearest",
				behavior: "smooth",
			});
		}
	}, [selectedIndex]);

	const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
		const value = e.target.value;
		setDisplayValue(value);
		setSearchQuery(value);
	};

	const handleFocus = () => {
		setIsDropdownVisible(true);
		// Quand l'utilisateur clique dans le champ, il veut probablement chercher
		// alors on sélectionne tout le texte pour faciliter la suppression
		if (inputRef.current) {
			inputRef.current.select();
		}
	};

	const handleClear = () => {
		setDisplayValue("");
		setSearchQuery("");
		setIsDropdownVisible(true);
		if (inputRef.current) {
			inputRef.current.focus();
		}
	};

	return (
		<div style={{ width: "100%" }}>
			<style>
				{`
				.model-item-highlight {
					background-color: var(--vscode-editor-findMatchHighlightBackground);
					color: inherit;
				}
				`}
			</style>
			<div style={{ display: "flex", flexDirection: "column" }}>
				<label htmlFor="model-search">
					<span style={{ fontWeight: 500 }}>Model</span>
				</label>

				<DropdownWrapper ref={dropdownRef}>
					<div style={{ position: "relative" }}>
						<CustomSearchInput
							ref={inputRef}
							id="model-search"
							placeholder="Search and select a model..."
							value={displayValue}
							onChange={handleInputChange}
							onFocus={handleFocus}
							onKeyDown={handleKeyDown}
						/>
						{displayValue && (
							<ClearButton onClick={handleClear}>
								<span className="codicon codicon-close" />
							</ClearButton>
						)}
					</div>
					{isDropdownVisible && (
						<DropdownList ref={dropdownListRef}>
							{modelSearchResults.map((item, index) => {
								const isFavorite = (apiConfiguration?.favoritedModelIds || []).includes(item.id);
								// Utiliser le contenu HTML pour l'affichage dans la liste uniquement
								const displayContent = item.html;
								
								return (
									<DropdownItem
										key={item.id}
										ref={(el) => (itemRefs.current[index] = el)}
										isSelected={index === selectedIndex}
										onMouseEnter={() => setSelectedIndex(index)}
										onClick={() => {
											handleModelChange(item.id);
											setIsDropdownVisible(false);
										}}>
										<div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
											<span dangerouslySetInnerHTML={{ __html: displayContent }} />
											<StarIcon
												isFavorite={isFavorite}
												onClick={(e) => {
													e.stopPropagation();
													vscode.postMessage({
														type: "toggleFavoriteModel",
														modelId: item.id,
													});
												}}
											/>
										</div>
									</DropdownItem>
								);
							})}
						</DropdownList>
					)}
				</DropdownWrapper>
			</div>

			{hasInfo ? (
				<ModelInfoView
					selectedModelId={selectedModelId}
					modelInfo={selectedModelInfo}
					isDescriptionExpanded={isDescriptionExpanded}
					setIsDescriptionExpanded={setIsDescriptionExpanded}
					isPopup={isPopup}
				/>
			) : (
				<p
					style={{
						fontSize: "12px",
						marginTop: 0,
						color: "var(--vscode-descriptionForeground)",
					}}>
					<>
						The extension automatically retrieves the list of available models on{" "}
						<VSCodeLink style={{ display: "inline", fontSize: "inherit" }} href="https://makehub.ai/models">
							MakeHub.
						</VSCodeLink>
						{" "}
						If you don't see any models, please check your API key and internet connection.
					</>
				</p>
			)}
		</div>
	);
};

export default MakehubModelPicker;

// Dropdown
const DropdownWrapper = styled.div`
	position: relative;
	width: 100%;
`;

const DropdownList = styled.div`
	position: absolute;
	top: calc(100% - 3px);
	left: 0;
	width: calc(100% - 2px);
	max-height: 200px;
	overflow-y: auto;
	background-color: var(--vscode-dropdown-background);
	border: 1px solid var(--vscode-list-activeSelectionBackground);
	z-index: ${MAKEHUB_MODEL_PICKER_Z_INDEX - 1};
	border-bottom-left-radius: 3px;
	border-bottom-right-radius: 3px;
`;

const DropdownItem = styled.div<{ isSelected: boolean }>`
	padding: 5px 10px;
	cursor: pointer;
	word-break: break-all;
	white-space: normal;

	background-color: ${({ isSelected }) => (isSelected ? "var(--vscode-list-activeSelectionBackground)" : "inherit")};

	&:hover {
		background-color: var(--vscode-list-activeSelectionBackground);
	}
`;