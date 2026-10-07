import { faArrowRight, faCircleCheck, faCashRegister, faPlus, faPenToSquare, faBoxArchive, faRotateLeft, faClipboardList, faTableList, faXmark, faSort, faSortUp, faSortDown, faUsers, faBriefcase, faMoneyBillWave, faLayerGroup, faPrint, faClockRotateLeft, faArrowsRotate, faFloppyDisk, faEye, faSliders } from '@fortawesome/free-solid-svg-icons';
const icons={next:faArrowRight,complete:faCircleCheck,drawer:faCashRegister,add:faPlus,edit:faPenToSquare,archive:faBoxArchive,restore:faRotateLeft,audit:faClipboardList,table:faTableList,close:faXmark,sort:faSort,ascending:faSortUp,descending:faSortDown,customers:faUsers,jobs:faBriefcase,payments:faMoneyBillWave,materials:faLayerGroup,services:faPrint,history:faClockRotateLeft,sync:faArrowsRotate,save:faFloppyDisk,details:faEye,quantity:faSliders};
export type IconName=keyof typeof icons;
export default function Icon({name}:{name:IconName}) {
 const [width,height,,,paths]=icons[name].icon;
 return <svg className="app-icon" viewBox={`0 0 ${width} ${height}`} aria-hidden="true" focusable="false">{(Array.isArray(paths)?paths:[paths]).map((path,index)=><path d={path} key={index}/>)}</svg>;
}

