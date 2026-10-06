import { DEFAULT_SETTINGS, loadSettings, onSettingsChanged } from '../shared/settings'
import { PageTranslator } from './page-translate'

// O material escrito da aula é exibido pelo site dentro de um quadro (iframe) à parte, que o
// script principal não alcança. Este script roda em todos os quadros e só cuida da tradução do
// texto; no documento principal não faz nada, pois lá o script principal já traduz.
if (window !== window.top) {
  let settings = DEFAULT_SETTINGS
  const translator = new PageTranslator(
    () => settings.glossary,
    () => false,
    true,
  )
  onSettingsChanged((changed) => {
    settings = changed
    void translator.setEnabled(settings.translatePage)
  })
  void loadSettings().then((loaded) => {
    settings = loaded
    void translator.setEnabled(settings.translatePage)
  })
}
