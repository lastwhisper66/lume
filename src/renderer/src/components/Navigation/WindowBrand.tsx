import icon from '../../../../../resources/icon.png?url'

export function WindowBrand(): React.JSX.Element {
  return (
    <div className="window-brand" aria-label="Lume">
      <img className="window-brand-icon" src={icon} alt="" />
      <span className="window-brand-name">Lume</span>
    </div>
  )
}

export default WindowBrand
