use crate::{ArenaError, GameSpec, ModeSpec, PlayerKind, PlayerSelection, PlayerSlot, Result};
use std::collections::BTreeMap;

pub fn resolve_players(
    game: &GameSpec,
    mode: &ModeSpec,
    requested: Option<&[PlayerSelection]>,
    model: Option<&str>,
) -> Result<Vec<PlayerSelection>> {
    let mut selections: BTreeMap<&str, &PlayerSelection> = BTreeMap::new();
    if let Some(players) = requested {
        for player in players {
            if selections.insert(player.slot.as_str(), player).is_some() {
                return Err(ArenaError::Request(format!(
                    "Duplicate player: {}",
                    player.slot
                )));
            }
        }
        if selections.len() != mode.players.len()
            || mode
                .players
                .iter()
                .any(|slot: &PlayerSlot| !selections.contains_key(slot.key.as_str()))
        {
            return Err(ArenaError::Request(
                "Players must exactly match the mode's slots".into(),
            ));
        }
    }
    mode.players
        .iter()
        .map(|slot: &PlayerSlot| {
            let selection: Option<&PlayerSelection> = selections.get(slot.key.as_str()).copied();
            if selection
                .is_some_and(|player: &PlayerSelection| player.player_type != slot.player_type)
            {
                return Err(ArenaError::Request(format!(
                    "Invalid player type: {}",
                    slot.key
                )));
            }
            let selected_model: Option<String> = if slot.player_type == PlayerKind::Model {
                let requested_model: Option<&str> = selection
                    .and_then(|player: &PlayerSelection| player.model.as_deref())
                    .filter(|id: &&str| !id.is_empty())
                    .or(model);
                let id: String = match requested_model {
                    Some(id) => id.to_owned(),
                    None => game.default_model()?.id.clone(),
                };
                game.model(&id)?;
                Some(id)
            } else {
                None
            };
            Ok(PlayerSelection {
                slot: slot.key.clone(),
                player_type: slot.player_type,
                model: selected_model,
            })
        })
        .collect()
}
